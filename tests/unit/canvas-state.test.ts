import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { computeGroupBounds, findOpenCanvasPosition } from '../../src/server/placement.ts';
import {
  createTestWorkspace,
  makeNode,
  readPersistedCanvasState,
  removeTestWorkspace,
  resetCanvasForTests,
  waitForPersistence,
} from './helpers.ts';

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

    await waitForPersistence();
    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(persisted.nodes.map((node) => node.id).sort()).toEqual([groupNode.id, secondNode.id]);
    expect(persisted.edges).toEqual([]);
    expect(persisted.contextPins).toEqual([firstNode.id, secondNode.id]);
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

    expect(canvasState.deleteSnapshot(snapshot!.id)).toBe(true);
    expect(canvasState.listSnapshots()).toEqual([]);
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
      x: 60,
      y: 128,
      width: 800,
      height: 412,
    });
  });
});
