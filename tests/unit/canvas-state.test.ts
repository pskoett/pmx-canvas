import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loadStateFromDB } from '../../src/server/canvas-db.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { AX_TIMELINE_RETENTION } from '../../src/server/ax-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { computeGroupBounds, findOpenCanvasPosition } from '../../src/server/placement.ts';
import {
  createTestWorkspace,
  makeNode,
  readPersistedCanvasState,
  removeTestWorkspace,
  resetCanvasForTests,
  waitForPersistence,
} from './helpers.ts';

function overlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

describe('canvas state manager', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-state-');
    resetCanvasForTests(workspaceRoot);
  });

  afterEach(() => {
    removeTestWorkspace(workspaceRoot);
  });

  test('groups nodes, prunes removed children, and persists canvas state', async () => {
    const groupNode = makeNode({
      id: 'group-1',
      type: 'group',
      size: { width: 700, height: 420 },
      data: { title: 'Investigation', children: [] },
    });
    const firstNode = makeNode({
      id: 'node-a',
      type: 'markdown',
      position: { x: 120, y: 160 },
      data: { title: 'Alpha' },
    });
    const secondNode = makeNode({
      id: 'node-b',
      type: 'markdown',
      position: { x: 520, y: 160 },
      data: { title: 'Beta' },
    });

    canvasState.addNode(groupNode);
    canvasState.addNode(firstNode);
    canvasState.addNode(secondNode);
    canvasState.addEdge({ id: 'edge-1', from: firstNode.id, to: secondNode.id, type: 'flow' });

    expect(canvasState.groupNodes(groupNode.id, [firstNode.id, secondNode.id])).toBe(true);
    canvasState.setContextPins([firstNode.id, secondNode.id, 'missing-node']);

    expect(Array.from(canvasState.contextPinnedNodeIds)).toEqual([firstNode.id, secondNode.id]);
    expect(canvasState.getNode(firstNode.id)?.data.parentGroup).toBe(groupNode.id);
    expect(canvasState.getNode(groupNode.id)?.data.children as string[]).toEqual([firstNode.id, secondNode.id]);

    canvasState.removeNode(firstNode.id);

    expect(canvasState.getNode(firstNode.id)).toBeUndefined();
    expect(canvasState.getEdges()).toEqual([]);
    expect(canvasState.getNode(groupNode.id)?.data.children as string[]).toEqual([secondNode.id]);
    expect(Array.from(canvasState.contextPinnedNodeIds)).toEqual([secondNode.id]);

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.nodes.map((node) => node.id).sort()).toEqual([groupNode.id, secondNode.id]);
    expect(persisted.edges).toEqual([]);
    expect(persisted.contextPins).toEqual([secondNode.id]);
  });

  test('persists annotations separately from nodes and edges', async () => {
    canvasState.addAnnotation({
      id: 'ann-1',
      type: 'freehand',
      points: [{ x: 10, y: 20 }, { x: 40, y: 80 }],
      bounds: { x: 10, y: 20, width: 30, height: 60 },
      color: '#f97316',
      width: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const layout = canvasState.getLayout();
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.annotations).toHaveLength(1);
    expect(layout.annotations[0]?.points).toHaveLength(2);

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.annotations).toHaveLength(1);
    expect(persisted.annotations?.[0]?.id).toBe('ann-1');
  });

  test('persists the selected canvas theme', async () => {
    expect(canvasState.theme).toBe('dark');
    expect(canvasState.setTheme('light')).toBe('light');

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.theme).toBe('light');

    resetCanvasForTests(workspaceRoot);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(canvasState.theme).toBe('light');
    expect(canvasState.getLayout().theme).toBe('light');
  });

  test('treats missing persisted theme metadata as no saved preference', async () => {
    canvasState.setTheme('light');
    canvasState.flushToDisk();

    const dbPath = join(workspaceRoot, '.pmx-canvas', 'canvas.db');
    const writableDb = new Database(dbPath);
    try {
      writableDb.run('DELETE FROM meta WHERE key = ?', ['theme']);
    } finally {
      writableDb.close();
    }

    const readonlyDb = new Database(dbPath, { readonly: true });
    try {
      const restored = loadStateFromDB(readonlyDb);
      expect(restored?.theme).toBeUndefined();
    } finally {
      readonlyDb.close();
    }
  });

  test('persists text annotations', async () => {
    canvasState.addAnnotation({
      id: 'ann-text',
      type: 'text',
      points: [{ x: 20, y: 40 }],
      bounds: { x: 20, y: 16, width: 120, height: 28.8 },
      color: 'currentColor',
      width: 24,
      text: 'Intent note',
      label: 'Intent note',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(canvasState.getLayout().annotations[0]?.type).toBe('text');
    expect(canvasState.getLayout().annotations[0]?.text).toBe('Intent note');

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.annotations?.[0]?.type).toBe('text');
    expect(persisted.annotations?.[0]?.text).toBe('Intent note');
  });

  test('removes annotations and persists the removal', async () => {
    canvasState.addAnnotation({
      id: 'ann-remove',
      type: 'freehand',
      points: [{ x: 10, y: 20 }, { x: 40, y: 80 }],
      bounds: { x: 10, y: 20, width: 30, height: 60 },
      color: 'currentColor',
      width: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(canvasState.removeAnnotation('ann-remove')).toBe(true);
    expect(canvasState.removeAnnotation('ann-missing')).toBe(false);
    expect(canvasState.getAnnotations()).toEqual([]);

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.annotations).toEqual([]);
  });

  test('records annotation removal for undo and redo', () => {
    canvasState.onMutation((info) => {
      mutationHistory.record({
        description: info.description,
        operationType: info.operationType,
        forward: info.forward,
        inverse: info.inverse,
      });
    });
    canvasState.addAnnotation({
      id: 'ann-history',
      type: 'freehand',
      points: [{ x: 10, y: 20 }, { x: 40, y: 80 }],
      bounds: { x: 10, y: 20, width: 30, height: 60 },
      color: 'currentColor',
      width: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    canvasState.removeAnnotation('ann-history');

    expect(mutationHistory.getSummaries().at(-1)?.operationType).toBe('removeAnnotation');
    mutationHistory.undo();
    expect(canvasState.getAnnotations().map((annotation) => annotation.id)).toEqual(['ann-history']);
    mutationHistory.redo();
    expect(canvasState.getAnnotations()).toEqual([]);
  });

  test('saves, restores, lists, and deletes snapshots', () => {
    const firstNode = makeNode({
      id: 'node-1',
      type: 'markdown',
      data: { title: 'Original title', content: '# Original' },
    });
    const secondNode = makeNode({
      id: 'node-2',
      type: 'status',
      position: { x: 480, y: 80 },
      size: { width: 300, height: 120 },
      data: { title: 'Status', message: 'Ready' },
    });

    canvasState.addNode(firstNode);
    canvasState.addNode(secondNode);
    canvasState.addEdge({ id: 'edge-restore', from: firstNode.id, to: secondNode.id, type: 'references' });
    canvasState.setContextPins([firstNode.id, 'missing']);

    const snapshot = canvasState.saveSnapshot('baseline');
    expect(snapshot).not.toBeNull();
    expect(canvasState.listSnapshots().map((item) => item.name)).toEqual(['baseline']);

    canvasState.updateNode(firstNode.id, {
      data: { ...firstNode.data, title: 'Changed title', content: '# Changed' },
      position: { x: 920, y: 400 },
    });
    canvasState.removeEdge('edge-restore');
    canvasState.clearContextPins();

    expect(canvasState.restoreSnapshot(snapshot!.id)).toBe(true);
    expect(canvasState.getNode(firstNode.id)?.data.title).toBe('Original title');
    expect(canvasState.getEdges()).toHaveLength(1);
    expect(Array.from(canvasState.contextPinnedNodeIds)).toEqual([firstNode.id]);
    expect(canvasState.restoreSnapshot('baseline')).toBe(true);
    expect(canvasState.getNode(firstNode.id)?.data.title).toBe('Original title');

    expect(canvasState.deleteSnapshot(snapshot!.id)).toBe(true);
    expect(canvasState.listSnapshots()).toEqual([]);
  });

  test('persists and restores AX focus with canvas state and snapshots', async () => {
    const firstNode = makeNode({ id: 'ax-node-a', type: 'markdown', data: { title: 'AX A', content: 'Alpha' } });
    const secondNode = makeNode({ id: 'ax-node-b', type: 'markdown', data: { title: 'AX B', content: 'Beta' } });
    canvasState.addNode(firstNode);
    canvasState.addNode(secondNode);

    const focus = canvasState.setAxFocus([firstNode.id, secondNode.id, 'missing-node'], { source: 'api' });
    expect(focus.nodeIds).toEqual([firstNode.id, secondNode.id]);
    expect(focus.primaryNodeId).toBe(firstNode.id);
    expect(focus.source).toBe('api');

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.ax?.focus.nodeIds).toEqual([firstNode.id, secondNode.id]);

    const snapshot = canvasState.saveSnapshot('ax-focus-baseline');
    expect(snapshot).not.toBeNull();

    canvasState.setAxFocus([secondNode.id], { source: 'mcp' });
    expect(canvasState.getAxFocus().nodeIds).toEqual([secondNode.id]);

    expect(canvasState.restoreSnapshot(snapshot!.id)).toBe(true);
    expect(canvasState.getAxFocus().nodeIds).toEqual([firstNode.id, secondNode.id]);

    canvasState.removeNode(firstNode.id);
    expect(canvasState.getAxFocus().nodeIds).toEqual([secondNode.id]);
  });

  test('persists and snapshots canvas-bound AX work items, approvals, and review annotations', async () => {
    const node = makeNode({ id: 'wi-node', type: 'markdown', data: { title: 'Work node', content: 'Body' } });
    canvasState.addNode(node);

    const workItem = canvasState.addWorkItem({ title: 'Wire auth', status: 'in-progress', nodeIds: [node.id] }, { source: 'api' });
    expect(workItem.status).toBe('in-progress');
    expect(workItem.nodeIds).toEqual([node.id]);

    const gate = canvasState.requestApproval({ title: 'Deploy', action: 'deploy.prod' }, { source: 'api' });
    expect(gate.status).toBe('pending');

    const review = canvasState.addReviewAnnotation(
      { body: 'needs a test', kind: 'finding', severity: 'warning', anchorType: 'node', nodeId: node.id },
      { source: 'api' },
    );
    expect(review.status).toBe('open');
    expect(review.nodeId).toBe(node.id);

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.ax?.workItems.map((w) => w.id)).toEqual([workItem.id]);
    expect(persisted.ax?.approvalGates.map((g) => g.id)).toEqual([gate.id]);
    expect(persisted.ax?.reviewAnnotations.map((r) => r.id)).toEqual([review.id]);

    const snapshot = canvasState.saveSnapshot('ax-canvas-bound');
    expect(snapshot).not.toBeNull();

    // Mutate after snapshot, then restore — canvas-bound AX rides the snapshot blob.
    canvasState.updateWorkItem(workItem.id, { status: 'done' });
    canvasState.resolveApproval(gate.id, 'approved');
    expect(canvasState.getWorkItems()[0]?.status).toBe('done');
    expect(canvasState.getApprovalGates()[0]?.status).toBe('approved');

    expect(canvasState.restoreSnapshot(snapshot!.id)).toBe(true);
    expect(canvasState.getWorkItems()[0]?.status).toBe('in-progress');
    expect(canvasState.getApprovalGates()[0]?.status).toBe('pending');
    expect(canvasState.getReviewAnnotations().map((r) => r.id)).toEqual([review.id]);
  });

  test('drops node-anchored review annotations when the anchor node is removed', () => {
    const node = makeNode({ id: 'rev-node', type: 'markdown', data: { title: 'Review node' } });
    canvasState.addNode(node);
    const review = canvasState.addReviewAnnotation({ body: 'fix this', anchorType: 'node', nodeId: node.id }, { source: 'api' });
    expect(canvasState.getReviewAnnotations().map((r) => r.id)).toEqual([review.id]);

    canvasState.removeNode(node.id);
    expect(canvasState.getReviewAnnotations()).toEqual([]);
  });

  test('rejects node-anchored review annotations with a missing or unknown nodeId instead of false success', () => {
    // Default anchorType is 'node'; a call with no nodeId must reject, not
    // silently store nothing while returning a phantom success object.
    expect(canvasState.addReviewAnnotation({ body: 'no anchor' }, { source: 'api' })).toBeNull();
    expect(canvasState.addReviewAnnotation({ body: 'bad anchor', anchorType: 'node', nodeId: 'does-not-exist' }, { source: 'api' })).toBeNull();
    expect(canvasState.getReviewAnnotations()).toEqual([]);

    // A file anchor needs no node, and a valid node anchor succeeds.
    const fileReview = canvasState.addReviewAnnotation({ body: 'file note', anchorType: 'file', file: 'src/x.ts' }, { source: 'api' });
    expect(fileReview).not.toBeNull();
    const anchorNode = makeNode({ id: 'rev-ok-node', type: 'markdown', data: { title: 'Anchor' } });
    canvasState.addNode(anchorNode);
    const nodeReview = canvasState.addReviewAnnotation({ body: 'node note', anchorType: 'node', nodeId: anchorNode.id }, { source: 'api' });
    expect(nodeReview).not.toBeNull();
    expect(canvasState.getReviewAnnotations().map((r) => r.id).sort()).toEqual([fileReview!.id, nodeReview!.id].sort());
  });

  test('records the AX timeline in the DB but excludes it from snapshots', async () => {
    const event = canvasState.recordAxEvent({ kind: 'tool-start', summary: 'ran tests' }, { source: 'api' });
    const evidence = canvasState.addEvidence({ kind: 'test-output', title: 'unit pass' }, { source: 'api' });
    const steering = canvasState.recordSteeringMessage('focus on the failing test', { source: 'api' });
    expect(event.kind).toBe('tool-start');
    expect(evidence.kind).toBe('test-output');
    expect(steering.delivered).toBe(false);

    const timeline = canvasState.getAxTimeline();
    expect(timeline.events.map((e) => e.id)).toContain(event.id);
    expect(timeline.evidence.map((e) => e.id)).toContain(evidence.id);
    expect(timeline.steering.map((s) => s.id)).toContain(steering.id);

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    // Timeline is a separate partition — never serialized into the snapshot blob.
    expect(persisted.ax).not.toHaveProperty('events');
    expect(persisted.ax).not.toHaveProperty('evidence');
    expect(persisted.ax).not.toHaveProperty('steering');
    expect(persisted.ax).not.toHaveProperty('host');
  });

  test('marks steering messages delivered and bounds timeline by retention', () => {
    const steering = canvasState.recordSteeringMessage('first message', { source: 'api' });
    expect(canvasState.getAxSteering({ onlyPending: true }).map((s) => s.id)).toContain(steering.id);
    expect(canvasState.markSteeringDelivered(steering.id)).toBe(true);
    expect(canvasState.getAxSteering({ onlyPending: true }).map((s) => s.id)).not.toContain(steering.id);

    for (let i = 0; i < AX_TIMELINE_RETENTION + 5; i++) {
      canvasState.recordAxEvent({ kind: 'tool-result', summary: `event ${i}` }, { source: 'api' });
    }
    expect(canvasState.getAxTimelineSummary().counts.events).toBe(AX_TIMELINE_RETENTION);
  });

  test('clear() empties canvas-bound AX state but keeps timeline and host capability', async () => {
    const node = makeNode({ id: 'clear-node', type: 'markdown', data: { title: 'Clear node' } });
    canvasState.addNode(node);
    canvasState.addWorkItem({ title: 'survives?' }, { source: 'api' });
    const event = canvasState.recordAxEvent({ kind: 'prompt', summary: 'a prompt' }, { source: 'api' });
    const host = canvasState.setHostCapability({ host: 'copilot', capabilities: { canvas: true, sessionMessaging: true } }, { source: 'api' });
    expect(host.host).toBe('copilot');
    expect(host.sessionMessaging).toBe(true);

    canvasState.clear();
    expect(canvasState.getWorkItems()).toEqual([]);
    // Timeline + host survive clear (separate partitions).
    expect(canvasState.getAxEvents().map((e) => e.id)).toContain(event.id);
    expect(canvasState.getHostCapability()?.host).toBe('copilot');

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.ax?.workItems).toEqual([]);
  });

  test('limits, filters, and garbage-collects snapshots', async () => {
    const snapshots: Array<NonNullable<ReturnType<typeof canvasState.saveSnapshot>>> = [];
    for (const name of ['alpha', 'beta', 'alpha-old']) {
      const saved = canvasState.saveSnapshot(name);
      expect(saved).not.toBeNull();
      snapshots.push(saved!);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    expect(canvasState.listSnapshots({ all: true }).map((item) => item.name)).toEqual(['alpha-old', 'beta', 'alpha']);
    expect(canvasState.listSnapshots({ limit: 2 }).map((item) => item.name)).toEqual(['alpha-old', 'beta']);
    expect(canvasState.listSnapshots({ query: 'alpha' }).map((item) => item.name)).toEqual(['alpha-old', 'alpha']);

    const preview = canvasState.gcSnapshots({ keep: 1, dryRun: true });
    expect(preview.deleted.map((item) => item.name)).toEqual(['beta', 'alpha']);
    expect(canvasState.listSnapshots({ all: true })).toHaveLength(3);

    const result = canvasState.gcSnapshots({ keep: 1 });
    expect(result).toEqual({
      ok: true,
      kept: 1,
      dryRun: false,
      deleted: [snapshots[1], snapshots[0]],
    });
    expect(canvasState.listSnapshots({ all: true }).map((item) => item.name)).toEqual(['alpha-old']);
  });

  test('persists webpage node URLs and cached text snapshots', async () => {
    const webpageNode = makeNode({
      id: 'webpage-1',
      type: 'webpage',
      data: {
        title: 'Saved webpage',
        url: 'https://example.com/article',
        pageTitle: 'Example article',
        content: 'Cached webpage text for later agent refresh.',
        excerpt: 'Cached webpage text for later agent refresh.',
        status: 'ready',
      },
    });

    canvasState.addNode(webpageNode);

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    const restored = persisted.nodes.find((node) => node.id === webpageNode.id);
    expect(restored?.type).toBe('webpage');
    expect(restored?.data.url).toBe('https://example.com/article');
    expect(restored?.data.content).toBe('Cached webpage text for later agent refresh.');
  });

  test('restores legacy snapshots with inferred provenance for source-backed nodes', () => {
    const notesPath = join(workspaceRoot, 'notes.md');
    const snapshotsDir = join(workspaceRoot, '.pmx-canvas', 'snapshots');
    mkdirSync(snapshotsDir, { recursive: true });

    writeFileSync(
      join(snapshotsDir, 'legacy-snapshot.json'),
      JSON.stringify({
        version: 1,
        snapshot: {
          id: 'legacy-snapshot',
          name: 'legacy',
          createdAt: '2026-04-22T10:00:00.000Z',
          nodeCount: 3,
          edgeCount: 0,
        },
        viewport: { x: 0, y: 0, scale: 1 },
        nodes: [
          makeNode({
            id: 'md-legacy',
            type: 'markdown',
            data: {
              path: notesPath,
              title: 'Notes',
              content: '# Notes',
            },
          }),
          makeNode({
            id: 'web-legacy',
            type: 'webpage',
            data: {
              title: 'Example',
              url: 'https://example.com/docs',
              content: 'Cached docs snapshot',
              fetchedAt: '2026-04-22T09:30:00.000Z',
            },
          }),
          makeNode({
            id: 'app-legacy',
            type: 'mcp-app',
            data: {
              mode: 'ext-app',
              title: 'Fixture app',
              serverName: 'fixture-server',
              toolName: 'open_counter',
              resourceUri: 'ui://fixture/counter.html',
            },
          }),
        ],
        edges: [],
        contextPins: ['md-legacy'],
      }, null, 2),
      'utf-8',
    );

    expect(canvasState.restoreSnapshot('legacy')).toBe(true);

    expect(canvasState.getNode('md-legacy')?.data.provenance).toMatchObject({
      sourceKind: 'workspace-file',
      refreshStrategy: 'file-read-write',
      details: {
        path: notesPath,
        nodeType: 'markdown',
      },
    });
    expect(canvasState.getNode('web-legacy')?.data.provenance).toMatchObject({
      sourceKind: 'webpage-url',
      sourceUri: 'https://example.com/docs',
      refreshStrategy: 'webpage-refresh',
      syncedAt: '2026-04-22T09:30:00.000Z',
    });
    expect(canvasState.getNode('app-legacy')?.data.provenance).toMatchObject({
      sourceKind: 'mcp-tool',
      refreshStrategy: 'mcp-app-rehydrate',
      details: {
        serverName: 'fixture-server',
        toolName: 'open_counter',
        resourceUri: 'ui://fixture/counter.html',
      },
    });
  });

  test('loadFromDisk replaces existing in-memory state instead of merging into it', async () => {
    const persistedNode = makeNode({
      id: 'persisted-node',
      type: 'markdown',
      data: { title: 'Persisted node' },
    });

    canvasState.addNode(persistedNode);
    canvasState.setContextPins([persistedNode.id]);
    await waitForPersistence();

    canvasState.addNode(
      makeNode({
        id: 'stale-node',
        type: 'status',
        position: { x: 520, y: 80 },
        data: { title: 'Stale node' },
      }),
    );
    expect(canvasState.getNode('stale-node')).toBeTruthy();

    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(canvasState.getNode('persisted-node')?.data.title).toBe('Persisted node');
    expect(canvasState.getNode('stale-node')).toBeUndefined();
    expect(Array.from(canvasState.contextPinnedNodeIds)).toEqual([persistedNode.id]);
  });

  test('returns cloned snapshots from getters instead of live mutable internals', () => {
    const node = makeNode({
      id: 'node-clone',
      type: 'markdown',
      data: { title: 'Original title', content: 'Original content' },
    });
    const edge = { id: 'edge-clone', from: 'node-clone', to: 'node-other', type: 'references' as const };
    const other = makeNode({ id: 'node-other', type: 'markdown' });

    canvasState.addNode(node);
    canvasState.addNode(other);
    canvasState.addEdge(edge);
    canvasState.addAnnotation({
      id: 'ann-clone',
      type: 'freehand',
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      bounds: { x: 1, y: 2, width: 2, height: 2 },
      color: '#f97316',
      width: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    canvasState.setContextPins([node.id]);

    const fetchedNode = canvasState.getNode(node.id)!;
    fetchedNode.data.title = 'Mutated outside';

    const layout = canvasState.getLayout();
    layout.viewport.x = 999;
    layout.nodes[0]!.position.x = 999;
    layout.edges[0]!.label = 'outside';
    layout.annotations[0]!.points[0]!.x = 999;

    const pins = canvasState.contextPinnedNodeIds;
    pins.clear();

    expect(canvasState.getNode(node.id)?.data.title).toBe('Original title');
    expect(canvasState.getLayout().viewport.x).toBe(0);
    expect(canvasState.getNode(node.id)?.position.x).toBe(40);
    expect(canvasState.getEdges()[0]?.label).toBeUndefined();
    expect(canvasState.getAnnotations()[0]?.points[0]?.x).toBe(1);
    expect(Array.from(canvasState.contextPinnedNodeIds)).toEqual([node.id]);
  });

  test('computes reusable placement bounds for new nodes and groups', () => {
    const placed = findOpenCanvasPosition(
      [
        makeNode({ id: 'node-left', type: 'markdown' }),
        makeNode({
          id: 'node-right',
          type: 'markdown',
          position: { x: 424, y: 80 },
        }),
      ],
      360,
      200,
    );

    expect(placed).toEqual({ x: 808, y: 80 });

    const bounds = computeGroupBounds([
      makeNode({
        id: 'one',
        type: 'markdown',
        position: { x: 100, y: 200 },
        size: { width: 360, height: 200 },
      }),
      makeNode({
        id: 'two',
        type: 'markdown',
        position: { x: 520, y: 260 },
        size: { width: 300, height: 240 },
      }),
    ]);

    expect(bounds).toEqual({
      x: 44,
      y: 112,
      width: 832,
      height: 444,
    });
  });

  test('recomputes parent group bounds when a grouped child moves or resizes', () => {
    const child = makeNode({
      id: 'node-child',
      type: 'markdown',
      position: { x: 120, y: 160 },
      size: { width: 360, height: 200 },
      data: { title: 'Child' },
    });

    canvasState.addNode(child);

    const groupId = 'group-dynamic';
    canvasState.addNode(makeNode({
      id: groupId,
      type: 'group',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      data: { title: 'Dynamic group', children: [] },
    }));

    expect(canvasState.groupNodes(groupId, [child.id])).toBe(true);
    expect(canvasState.getNode(groupId)?.position).toEqual({ x: 64, y: 72 });
    expect(canvasState.getNode(groupId)?.size).toEqual({ width: 472, height: 344 });

    canvasState.updateNode(child.id, {
      position: { x: 220, y: 260 },
      size: { width: 500, height: 320 },
    });

    expect(canvasState.getNode(groupId)?.position).toEqual({ x: 164, y: 172 });
    expect(canvasState.getNode(groupId)?.size).toEqual({ width: 612, height: 464 });
  });

  test('batch updates recompute parent group bounds when a grouped child moves', () => {
    const child = makeNode({
      id: 'node-child-batch',
      type: 'markdown',
      position: { x: 120, y: 160 },
      size: { width: 360, height: 200 },
      data: { title: 'Child batch' },
    });

    canvasState.addNode(child);

    const groupId = 'group-dynamic-batch';
    canvasState.addNode(makeNode({
      id: groupId,
      type: 'group',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      data: { title: 'Dynamic group batch', children: [] },
    }));

    expect(canvasState.groupNodes(groupId, [child.id])).toBe(true);
    expect(canvasState.getNode(groupId)?.position).toEqual({ x: 64, y: 72 });
    expect(canvasState.getNode(groupId)?.size).toEqual({ width: 472, height: 344 });

    expect(canvasState.applyUpdates([{
      id: child.id,
      position: { x: 220, y: 260 },
      size: { width: 500, height: 320 },
    }])).toEqual({ applied: 1, skipped: 0 });

    expect(canvasState.getNode(groupId)?.position).toEqual({ x: 164, y: 172 });
    expect(canvasState.getNode(groupId)?.size).toEqual({ width: 612, height: 464 });
  });

  test('moving a group translates its child nodes', () => {
    const first = makeNode({
      id: 'node-child-1',
      type: 'markdown',
      position: { x: 120, y: 160 },
      size: { width: 360, height: 200 },
      data: { title: 'Child one' },
    });
    const second = makeNode({
      id: 'node-child-2',
      type: 'file',
      position: { x: 520, y: 160 },
      size: { width: 400, height: 240 },
      data: { title: 'Child two' },
    });

    canvasState.addNode(first);
    canvasState.addNode(second);
    canvasState.addNode(makeNode({
      id: 'group-move',
      type: 'group',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      data: { title: 'Move group', children: [] },
    }));

    expect(canvasState.groupNodes('group-move', [first.id, second.id])).toBe(true);

    const beforeFirst = canvasState.getNode(first.id)!;
    const beforeSecond = canvasState.getNode(second.id)!;
    const beforeGroup = canvasState.getNode('group-move')!;

    expect(canvasState.applyUpdates([{
      id: 'group-move',
      position: {
        x: beforeGroup.position.x + 140,
        y: beforeGroup.position.y + 90,
      },
    }])).toEqual({ applied: 1, skipped: 0 });

    expect(canvasState.getNode(first.id)?.position).toEqual({
      x: beforeFirst.position.x + 140,
      y: beforeFirst.position.y + 90,
    });
    expect(canvasState.getNode(second.id)?.position).toEqual({
      x: beforeSecond.position.x + 140,
      y: beforeSecond.position.y + 90,
    });
    expect(canvasState.getNode('group-move')?.position).toEqual({
      x: beforeGroup.position.x + 140,
      y: beforeGroup.position.y + 90,
    });
  });

  test('grouping compacts scattered children into the group bounds', () => {
    const first = makeNode({
      id: 'node-1',
      type: 'markdown',
      position: { x: 40, y: 40 },
      size: { width: 400, height: 220 },
      data: { title: 'One' },
    });
    const second = makeNode({
      id: 'node-2',
      type: 'file',
      position: { x: 1400, y: 900 },
      size: { width: 500, height: 320 },
      data: { title: 'Two' },
    });
    const third = makeNode({
      id: 'node-3',
      type: 'image',
      position: { x: 2400, y: 1600 },
      size: { width: 360, height: 240 },
      data: { title: 'Three' },
    });

    canvasState.addNode(first);
    canvasState.addNode(second);
    canvasState.addNode(third);
    canvasState.addNode(makeNode({
      id: 'group-packed',
      type: 'group',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      data: { title: 'Packed', children: [] },
    }));

    expect(canvasState.groupNodes('group-packed', [first.id, second.id, third.id])).toBe(true);

    const packedFirst = canvasState.getNode(first.id)!;
    const packedSecond = canvasState.getNode(second.id)!;
    const packedThird = canvasState.getNode(third.id)!;
    const group = canvasState.getNode('group-packed')!;

    expect(packedFirst.position).toEqual({ x: 40, y: 40 });
    expect(packedSecond.position).toEqual({ x: 472, y: 40 });
    expect(packedThird.position).toEqual({ x: 40, y: 392 });
    expect(group.position).toEqual({ x: -16, y: -48 });
    expect(group.size).toEqual({ width: 1044, height: 736 });
  });

  test('grouping shifts a packed group clear of existing groups', () => {
    canvasState.addNode(makeNode({
      id: 'group-a',
      type: 'group',
      position: { x: 0, y: -32 },
      size: { width: 840, height: 700 },
      data: { title: 'Existing', children: [] },
    }));

    const first = makeNode({
      id: 'node-a',
      type: 'markdown',
      position: { x: 40, y: 40 },
      size: { width: 760, height: 600 },
    });
    const second = makeNode({
      id: 'node-b',
      type: 'image',
      position: { x: 40, y: 840 },
      size: { width: 760, height: 320 },
    });

    canvasState.addNode(first);
    canvasState.addNode(second);
    canvasState.addNode(makeNode({
      id: 'group-b',
      type: 'group',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      data: { title: 'Shifted', children: [] },
    }));

    expect(canvasState.groupNodes('group-b', [first.id, second.id])).toBe(true);

    const groupA = canvasState.getNode('group-a')!;
    const groupB = canvasState.getNode('group-b')!;
    expect(overlap(
      { ...groupA.position, ...groupA.size },
      { ...groupB.position, ...groupB.size },
    )).toBe(false);
  });

  test('grouping keeps side-by-side groups from overlapping horizontally', () => {
    canvasState.addNode(makeNode({
      id: 'group-left',
      type: 'group',
      position: { x: 0, y: -32 },
      size: { width: 840, height: 2402 },
      data: { title: 'Left', children: [] },
    }));

    const first = makeNode({
      id: 'right-1',
      type: 'status',
      position: { x: 840, y: 40 },
      size: { width: 340, height: 170 },
    });
    const second = makeNode({
      id: 'right-2',
      type: 'context',
      position: { x: 1220, y: 40 },
      size: { width: 360, height: 320 },
    });

    canvasState.addNode(first);
    canvasState.addNode(second);
    canvasState.addNode(makeNode({
      id: 'group-right',
      type: 'group',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      data: { title: 'Right', children: [] },
    }));

    expect(canvasState.groupNodes('group-right', [first.id, second.id])).toBe(true);

    const groupRight = canvasState.getNode('group-right')!;
    expect(groupRight.position).toEqual({ x: 888, y: -48 });
  });

  test('updating a grouped child moves only that child, not its siblings', () => {
    const groupId = 'group-move-target';
    canvasState.addNode(makeNode({
      id: groupId,
      type: 'group',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      data: { title: 'Move group', children: [] },
    }));
    const positions: Record<string, { x: number; y: number }> = {
      'mv-a': { x: 100, y: 100 },
      'mv-b': { x: 500, y: 100 },
      'mv-c': { x: 100, y: 420 },
      'mv-d': { x: 500, y: 420 },
    };
    const ids = Object.keys(positions);
    for (const id of ids) {
      canvasState.addNode(makeNode({
        id,
        type: 'markdown',
        position: positions[id],
        size: { width: 280, height: 180 },
        data: { title: id },
      }));
    }
    expect(canvasState.groupNodes(groupId, ids, { preservePositions: true })).toBe(true);

    // Move one child far away with a size in the patch (the 0.1.29 Repro B that
    // used to repack every sibling and ignore the requested coordinates).
    canvasState.updateNode('mv-a', { position: { x: 1000, y: 1000 }, size: { width: 280, height: 180 } });

    expect(canvasState.getNode('mv-a')!.position).toEqual({ x: 1000, y: 1000 });
    expect(canvasState.getNode('mv-b')!.position).toEqual({ x: 500, y: 100 });
    expect(canvasState.getNode('mv-c')!.position).toEqual({ x: 100, y: 420 });
    expect(canvasState.getNode('mv-d')!.position).toEqual({ x: 500, y: 420 });
  });

  test('growing grouped children preserves sibling positions (no auto-repack)', () => {
    const groupId = 'group-live';
    canvasState.addNode(makeNode({
      id: groupId,
      type: 'group',
      position: { x: 800, y: -32 },
      size: { width: 820, height: 712 },
      data: {
        title: 'Live group',
        children: ['status', 'context', 'ledger', 'trace-1', 'trace-2', 'trace-3'],
      },
    }));

    const childIds = ['status', 'context', 'ledger', 'trace-1', 'trace-2', 'trace-3'];
    for (const node of [
      makeNode({
        id: 'status',
        type: 'status',
        position: { x: 840, y: 40 },
        size: { width: 340, height: 170 },
        data: { parentGroup: groupId },
      }),
      makeNode({
        id: 'context',
        type: 'context',
        position: { x: 1220, y: 40 },
        size: { width: 360, height: 320 },
        data: { parentGroup: groupId },
      }),
      makeNode({
        id: 'ledger',
        type: 'ledger',
        position: { x: 1220, y: 390 },
        size: { width: 360, height: 240 },
        data: { parentGroup: groupId },
      }),
      makeNode({
        id: 'trace-1',
        type: 'trace',
        position: { x: 840, y: 240 },
        size: { width: 340, height: 60 },
        data: { parentGroup: groupId },
      }),
      makeNode({
        id: 'trace-2',
        type: 'trace',
        position: { x: 840, y: 316 },
        size: { width: 340, height: 60 },
        data: { parentGroup: groupId },
      }),
      makeNode({
        id: 'trace-3',
        type: 'trace',
        position: { x: 840, y: 392 },
        size: { width: 340, height: 60 },
        data: { parentGroup: groupId },
      }),
    ]) {
      canvasState.addNode(node);
    }

    const positionsBefore = new Map(
      childIds.map((id) => {
        const node = canvasState.getNode(id)!;
        return [id, { x: node.position.x, y: node.position.y }];
      }),
    );

    canvasState.updateNode('context', { size: { width: 360, height: 600 } });
    canvasState.updateNode('trace-1', { size: { width: 340, height: 165 } });
    canvasState.updateNode('trace-2', { size: { width: 340, height: 165 } });
    canvasState.updateNode('trace-3', { size: { width: 340, height: 165 } });

    // Resizing a grouped child must NOT repack siblings — the user owns the
    // layout (Bug #32 / 0.1.29 report). Every child keeps its position.
    for (const id of childIds) {
      expect(canvasState.getNode(id)!.position).toEqual(positionsBefore.get(id)!);
    }

    // The group frame still re-fits to contain its (now larger) children.
    const group = canvasState.getNode(groupId)!;
    for (const id of childIds) {
      const child = canvasState.getNode(id)!;
      expect(child.position.x).toBeGreaterThanOrEqual(group.position.x);
      expect(child.position.y).toBeGreaterThanOrEqual(group.position.y);
      expect(child.position.x + child.size.width).toBeLessThanOrEqual(group.position.x + group.size.width + 1);
      expect(child.position.y + child.size.height).toBeLessThanOrEqual(group.position.y + group.size.height + 1);
    }
  });

  test('migrates legacy .pmx-canvas.json and .pmx-canvas-snapshots/ into .pmx-canvas/', () => {
    const migrationWorkspace = createTestWorkspace('pmx-canvas-migrate-');

    const legacyState = join(migrationWorkspace, '.pmx-canvas.json');
    writeFileSync(
      legacyState,
      JSON.stringify({
        version: 1,
        viewport: { x: 10, y: 20, scale: 1.25 },
        nodes: [],
        edges: [],
        contextPins: [],
      }, null, 2),
      'utf-8',
    );

    const legacySnapshotsDir = join(migrationWorkspace, '.pmx-canvas-snapshots');
    mkdirSync(legacySnapshotsDir, { recursive: true });
    writeFileSync(join(legacySnapshotsDir, 'marker.json'), '{}', 'utf-8');

    try {
      resetCanvasForTests(migrationWorkspace);

      expect(existsSync(legacyState)).toBe(false);
      expect(existsSync(legacySnapshotsDir)).toBe(false);
      // Legacy state.json is migrated to SQLite, then renamed to .bak
      const stateJsonPath = join(migrationWorkspace, '.pmx-canvas', 'state.json');
      const stateJsonBakPath = `${stateJsonPath}.bak`;
      expect(existsSync(stateJsonPath) || existsSync(stateJsonBakPath)).toBe(true);
      expect(existsSync(join(migrationWorkspace, '.pmx-canvas', 'snapshots', 'marker.json'))).toBe(true);

      expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
      expect(canvasState.viewport).toEqual({ x: 10, y: 20, scale: 1.25 });
    } finally {
      removeTestWorkspace(migrationWorkspace);
    }
  });
});
