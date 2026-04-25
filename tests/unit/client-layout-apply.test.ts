import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  activeNodeId,
  applyServerCanvasLayout,
  contextPinnedNodeIds,
  collapseExpandedNode,
  edges,
  expandNode,
  expandedNodeId,
  nodes,
  pendingExpandedNodeCloseId,
  selectedNodeIds,
  updateNode,
  viewport,
} from '../../src/client/state/canvas-store.ts';
import type { CanvasEdge, CanvasNodeState } from '../../src/client/types.ts';

function makeNode(id: string, overrides: Partial<CanvasNodeState> = {}): CanvasNodeState {
  return {
    id,
    type: overrides.type ?? 'markdown',
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 320, height: 180 },
    zIndex: overrides.zIndex ?? 1,
    collapsed: overrides.collapsed ?? false,
    pinned: overrides.pinned ?? false,
    dockPosition: overrides.dockPosition ?? null,
    data: overrides.data ?? {},
  };
}

function makeEdge(id: string, from: string, to: string): CanvasEdge {
  return { id, from, to, type: 'relation' };
}

function resetClientState(): void {
  viewport.value = { x: 0, y: 0, scale: 1 };
  nodes.value = new Map();
  edges.value = new Map();
  activeNodeId.value = null;
  expandedNodeId.value = null;
  pendingExpandedNodeCloseId.value = null;
  selectedNodeIds.value = new Set();
  contextPinnedNodeIds.value = new Set();
}

describe('applyServerCanvasLayout', () => {
  beforeEach(() => {
    resetClientState();
  });

  afterEach(() => {
    resetClientState();
  });

  test('replaces the full client snapshot while preserving surviving focus state', () => {
    const first = makeNode('node-1', { zIndex: 2 });
    const second = makeNode('node-2', { zIndex: 5 });
    const firstEdge = makeEdge('edge-1', first.id, second.id);
    nodes.value = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    edges.value = new Map([[firstEdge.id, firstEdge]]);
    activeNodeId.value = second.id;
    expandedNodeId.value = second.id;
    selectedNodeIds.value = new Set([first.id, second.id, 'missing-node']);
    contextPinnedNodeIds.value = new Set([second.id, 'missing-node']);

    const updatedSecond = makeNode('node-2', {
      position: { x: 480, y: 240 },
      size: { width: 420, height: 260 },
      zIndex: 8,
      data: { title: 'Updated' },
    });
    const third = makeNode('node-3', { position: { x: 920, y: 240 }, zIndex: 3 });

    applyServerCanvasLayout({
      viewport: { x: 140, y: 220, scale: 0.75 },
      nodes: [updatedSecond, third],
      edges: [
        makeEdge('edge-2', updatedSecond.id, third.id),
        makeEdge('edge-stale', updatedSecond.id, 'missing-node'),
      ],
    });

    expect(viewport.value).toEqual({ x: 140, y: 220, scale: 0.75 });
    expect(Array.from(nodes.value.keys())).toEqual(['node-2', 'node-3']);
    expect(nodes.value.get('node-2')).toEqual(updatedSecond);
    expect(Array.from(edges.value.keys())).toEqual(['edge-2']);
    expect(activeNodeId.value).toBe('node-2');
    expect(expandedNodeId.value).toBe('node-2');
    expect(Array.from(selectedNodeIds.value)).toEqual(['node-2']);
    expect(Array.from(contextPinnedNodeIds.value)).toEqual(['node-2']);
  });

  test('clears focus state when the focused node is no longer present', () => {
    const first = makeNode('node-1');
    nodes.value = new Map([[first.id, first]]);
    activeNodeId.value = first.id;
    expandedNodeId.value = first.id;

    applyServerCanvasLayout({
      nodes: [makeNode('node-2')],
      edges: [],
    });

    expect(activeNodeId.value).toBeNull();
    expect(expandedNodeId.value).toBeNull();
  });

  test('delays Excalidraw collapse so debounced checkpoint saves can flush', async () => {
    const node = makeNode('diagram', {
      type: 'mcp-app',
      data: {
        mode: 'ext-app',
        serverName: 'Excalidraw',
        toolName: 'create_view',
      },
    });
    nodes.value = new Map([[node.id, node]]);

    expandNode(node.id);
    collapseExpandedNode();

    expect(expandedNodeId.value).toBe(node.id);
    expect(pendingExpandedNodeCloseId.value).toBe(node.id);

    await Bun.sleep(2550);

    expect(expandedNodeId.value).toBeNull();
    expect(pendingExpandedNodeCloseId.value).toBeNull();
  });

  test('closes Excalidraw focus as soon as a checkpoint update arrives', async () => {
    const node = makeNode('diagram', {
      type: 'mcp-app',
      data: {
        mode: 'ext-app',
        serverName: 'Excalidraw',
        toolName: 'create_view',
      },
    });
    nodes.value = new Map([[node.id, node]]);

    expandNode(node.id);
    collapseExpandedNode();
    updateNode(node.id, {
      data: {
        ...node.data,
        appCheckpoint: { updatedAt: 'saved' },
      },
    });

    expect(expandedNodeId.value).toBeNull();
    expect(pendingExpandedNodeCloseId.value).toBeNull();
  });
});
