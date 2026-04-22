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
    canvasState.setContextPins([node.id]);

    const fetchedNode = canvasState.getNode(node.id)!;
    fetchedNode.data.title = 'Mutated outside';

    const layout = canvasState.getLayout();
    layout.viewport.x = 999;
    layout.nodes[0]!.position.x = 999;
    layout.edges[0]!.label = 'outside';

    const pins = canvasState.contextPinnedNodeIds;
    pins.clear();

    expect(canvasState.getNode(node.id)?.data.title).toBe('Original title');
    expect(canvasState.getLayout().viewport.x).toBe(0);
    expect(canvasState.getNode(node.id)?.position.x).toBe(40);
    expect(canvasState.getEdges()[0]?.label).toBeUndefined();
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
      x: 60,
      y: 128,
      width: 800,
      height: 412,
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
    expect(canvasState.getNode(groupId)?.position).toEqual({ x: 80, y: 88 });
    expect(canvasState.getNode(groupId)?.size).toEqual({ width: 440, height: 312 });

    canvasState.updateNode(child.id, {
      position: { x: 220, y: 260 },
      size: { width: 500, height: 320 },
    });

    expect(canvasState.getNode(groupId)?.position).toEqual({ x: 180, y: 188 });
    expect(canvasState.getNode(groupId)?.size).toEqual({ width: 580, height: 432 });
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
    expect(canvasState.getNode(groupId)?.position).toEqual({ x: 80, y: 88 });
    expect(canvasState.getNode(groupId)?.size).toEqual({ width: 440, height: 312 });

    expect(canvasState.applyUpdates([{
      id: child.id,
      position: { x: 220, y: 260 },
      size: { width: 500, height: 320 },
    }])).toEqual({ applied: 1, skipped: 0 });

    expect(canvasState.getNode(groupId)?.position).toEqual({ x: 180, y: 188 });
    expect(canvasState.getNode(groupId)?.size).toEqual({ width: 580, height: 432 });
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
    expect(group.position).toEqual({ x: 0, y: -32 });
    expect(group.size).toEqual({ width: 1012, height: 704 });
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
    expect(groupRight.position).toEqual({ x: 888, y: -32 });
  });

  test('growing grouped children repacks siblings to avoid node overlap', () => {
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

    canvasState.updateNode('context', { size: { width: 360, height: 600 } });
    canvasState.updateNode('trace-1', { size: { width: 340, height: 165 } });
    canvasState.updateNode('trace-2', { size: { width: 340, height: 165 } });
    canvasState.updateNode('trace-3', { size: { width: 340, height: 165 } });

    const children = childIds
      .map((id) => canvasState.getNode(id)!)
      .map((node) => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.size.width,
        height: node.size.height,
      }));

    for (let index = 0; index < children.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < children.length; otherIndex += 1) {
        expect(overlap(children[index], children[otherIndex])).toBe(false);
      }
    }
  });
});
