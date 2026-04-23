import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  activeNeighborNodeIds,
  activeNodeId,
  edges,
  getNeighborNodeIds,
} from '../../src/client/state/canvas-store.ts';
import { computeMinimapFrame } from '../../src/client/canvas/Minimap.tsx';
import type { CanvasEdge, CanvasNodeState } from '../../src/client/types.ts';

function makeNode(id: string, x: number, y: number, width = 200, height = 120): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x, y },
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: {},
  };
}

function makeEdge(id: string, from: string, to: string): CanvasEdge {
  return { id, from, to, type: 'relation' };
}

function resetState(): void {
  activeNodeId.value = null;
  edges.value = new Map();
}

describe('client performance helpers', () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    resetState();
  });

  test('derives active neighbors once from the current edge graph', () => {
    const edgeMap = new Map<string, CanvasEdge>([
      ['edge-1', makeEdge('edge-1', 'node-a', 'node-b')],
      ['edge-2', makeEdge('edge-2', 'node-c', 'node-a')],
      ['edge-3', makeEdge('edge-3', 'node-b', 'node-d')],
    ]);

    expect(Array.from(getNeighborNodeIds('node-a', edgeMap)).sort()).toEqual(['node-b', 'node-c']);

    edges.value = edgeMap;
    activeNodeId.value = 'node-a';

    expect(Array.from(activeNeighborNodeIds.value).sort()).toEqual(['node-b', 'node-c']);
  });

  test('minimap frame expands to include both nodes and the current viewport', () => {
    const nodeMap = new Map<string, CanvasNodeState>([
      ['left', makeNode('left', 100, 100, 300, 200)],
      ['right', makeNode('right', 900, 650, 240, 180)],
    ]);

    const frame = computeMinimapFrame(
      nodeMap,
      { x: -80, y: -40, scale: 2 },
      1200,
      800,
    );

    expect(frame.bounds).toEqual({
      minX: 20,
      minY: 0,
      maxX: 1160,
      maxY: 850,
    });
    expect(frame.scale).toBeCloseTo(Math.min(180 / 1120, 120 / 850), 8);
  });
});
