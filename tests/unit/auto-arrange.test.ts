import { describe, expect, test } from 'bun:test';
import { computeAutoArrange, type ArrangeEdge, type ArrangeNode } from '../../src/shared/auto-arrange.ts';

function makeNode(overrides: Partial<ArrangeNode> & Pick<ArrangeNode, 'id' | 'type'>): ArrangeNode {
  return {
    id: overrides.id,
    type: overrides.type,
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 320, height: 180 },
    pinned: overrides.pinned ?? false,
    dockPosition: overrides.dockPosition ?? null,
    data: overrides.data ?? {},
  };
}

function overlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

describe('computeAutoArrange', () => {
  test('keeps grouped children together and separates group bounds in graph mode', () => {
    const nodes: ArrangeNode[] = [
      makeNode({ id: 'group-a', type: 'group', position: { x: 20, y: 20 }, size: { width: 900, height: 500 } }),
      makeNode({ id: 'group-b', type: 'group', position: { x: 1400, y: 20 }, size: { width: 900, height: 500 } }),
      makeNode({ id: 'a-1', type: 'markdown', position: { x: 80, y: 80 }, size: { width: 520, height: 320 }, data: { parentGroup: 'group-a' } }),
      makeNode({ id: 'a-2', type: 'image', position: { x: 80, y: 440 }, size: { width: 520, height: 220 }, data: { parentGroup: 'group-a' } }),
      makeNode({ id: 'b-1', type: 'mcp-app', position: { x: 1480, y: 80 }, size: { width: 760, height: 520 }, data: { parentGroup: 'group-b' } }),
      makeNode({ id: 'b-2', type: 'graph', position: { x: 1480, y: 640 }, size: { width: 420, height: 300 }, data: { parentGroup: 'group-b' } }),
    ];

    const edges: ArrangeEdge[] = [
      { id: 'edge-1', from: 'a-1', to: 'b-1' },
    ];

    const result = computeAutoArrange(nodes, edges, 'graph');

    const a1 = result.nodePositions.get('a-1');
    const a2 = result.nodePositions.get('a-2');
    const b1 = result.nodePositions.get('b-1');
    const b2 = result.nodePositions.get('b-2');
    const groupA = result.groupBounds.get('group-a');
    const groupB = result.groupBounds.get('group-b');

    expect(a1).toBeDefined();
    expect(a2).toBeDefined();
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    expect(groupA).toBeDefined();
    expect(groupB).toBeDefined();

    expect((a2?.x ?? 0) - (a1?.x ?? 0)).toBe(0);
    expect((a2?.y ?? 0) - (a1?.y ?? 0)).toBe(360);
    expect((b2?.x ?? 0) - (b1?.x ?? 0)).toBe(0);
    expect((b2?.y ?? 0) - (b1?.y ?? 0)).toBe(560);

    expect(overlap(groupA!, groupB!)).toBe(false);
  });

  test('packs grouped units and standalone nodes without overlapping in grid mode', () => {
    const nodes: ArrangeNode[] = [
      makeNode({ id: 'group-a', type: 'group', position: { x: 20, y: 20 }, size: { width: 900, height: 500 } }),
      makeNode({ id: 'a-1', type: 'markdown', position: { x: 80, y: 80 }, size: { width: 520, height: 320 }, data: { parentGroup: 'group-a' } }),
      makeNode({ id: 'a-2', type: 'image', position: { x: 80, y: 440 }, size: { width: 520, height: 220 }, data: { parentGroup: 'group-a' } }),
      makeNode({ id: 'solo-1', type: 'status', position: { x: 1400, y: 20 }, size: { width: 320, height: 180 } }),
      makeNode({ id: 'solo-2', type: 'trace', position: { x: 1800, y: 20 }, size: { width: 320, height: 180 } }),
    ];

    const result = computeAutoArrange(nodes, [], 'grid');
    const groupA = result.groupBounds.get('group-a');
    const solo1 = result.nodePositions.get('solo-1');
    const solo2 = result.nodePositions.get('solo-2');

    expect(groupA).toBeDefined();
    expect(solo1).toBeDefined();
    expect(solo2).toBeDefined();
    expect((solo2?.x ?? 0)).toBeGreaterThan((solo1?.x ?? 0));
    expect((groupA?.x ?? 0)).toBeLessThan((solo1?.x ?? 0));
  });
});
