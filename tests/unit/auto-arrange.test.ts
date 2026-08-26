import { describe, expect, test } from 'bun:test';
import { computeAutoArrange, type ArrangeEdge, type ArrangeNode } from '../../src/shared/auto-arrange.ts';

function makeNode(overrides: Partial<ArrangeNode> & Pick<ArrangeNode, 'id' | 'type'>): ArrangeNode {
  return {
    id: overrides.id,
    type: overrides.type,
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 320, height: 180 },
    pinned: overrides.pinned ?? false,
    data: overrides.data ?? {},
  };
}

function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe('computeAutoArrange', () => {
  test('two far-apart clusters each arrange in their own neighborhood — never interleaved (regression: the wild arrange)', () => {
    // The live board that broke: QA cards near the origin, a demo cluster
    // parked ~10k units away, a couple of edges. The old global repack
    // flow-packed every component at the origin sorted by pre-arrange y/x,
    // interleaving both worlds and destroying spatial memory.
    const qa = [
      makeNode({ id: 'qa-1', type: 'markdown', position: { x: 40, y: 80 } }),
      makeNode({ id: 'qa-2', type: 'markdown', position: { x: 700, y: 90 } }),
      makeNode({ id: 'qa-3', type: 'status', position: { x: 380, y: 500 } }),
    ];
    const demo = [
      makeNode({ id: 'demo-1', type: 'markdown', position: { x: 10000, y: -3960 } }),
      makeNode({ id: 'demo-2', type: 'webpage', position: { x: 10600, y: -3940 } }),
      makeNode({ id: 'demo-3', type: 'markdown', position: { x: 10250, y: -3500 } }),
    ];
    const edges: ArrangeEdge[] = [{ id: 'e1', from: 'qa-1', to: 'qa-3' }];

    for (const mode of ['grid', 'graph'] as const) {
      const result = computeAutoArrange([...qa, ...demo], edges, mode);
      const at = (id: string) => result.nodePositions.get(id)!;
      for (const node of [...qa, ...demo]) expect(result.nodePositions.has(node.id)).toBe(true);

      // Every node stays in its cluster's neighborhood: within 2000 units of
      // the cluster's original top-left anchor.
      for (const node of qa) {
        expect(Math.abs(at(node.id).x - 40)).toBeLessThan(2000);
        expect(Math.abs(at(node.id).y - 80)).toBeLessThan(2000);
      }
      for (const node of demo) {
        expect(Math.abs(at(node.id).x - 10000)).toBeLessThan(2000);
        expect(Math.abs(at(node.id).y - -3960)).toBeLessThan(2000);
      }

      // The clusters' arranged bounding boxes stay disjoint — no interleaving.
      const bbox = (ids: string[]) => {
        const xs = ids.map((id) => at(id).x);
        const ys = ids.map((id) => at(id).y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...ids.map((id) => at(id).x + 320)) - Math.min(...xs),
          height: Math.max(...ids.map((id) => at(id).y + 180)) - Math.min(...ys),
        };
      };
      expect(overlap(bbox(qa.map((n) => n.id)), bbox(demo.map((n) => n.id)))).toBe(false);
    }
  });

  test('a lone compact cluster arranges in place, anchored at its own origin', () => {
    const nodes = [
      makeNode({ id: 'a', type: 'markdown', position: { x: 5000, y: 3000 } }),
      makeNode({ id: 'b', type: 'markdown', position: { x: 5400, y: 3010 } }),
      makeNode({ id: 'c', type: 'markdown', position: { x: 5200, y: 3300 } }),
    ];
    const result = computeAutoArrange(nodes, [], 'grid');
    // Anchored at the cluster's min corner — not snapped to the board origin.
    const xs = nodes.map((n) => result.nodePositions.get(n.id)!.x);
    const ys = nodes.map((n) => result.nodePositions.get(n.id)!.y);
    expect(Math.min(...xs)).toBe(5000);
    expect(Math.min(...ys)).toBe(3000);
  });

  test('keeps grouped children together and separates group bounds in graph mode', () => {
    const nodes: ArrangeNode[] = [
      makeNode({ id: 'group-a', type: 'group', position: { x: 20, y: 20 }, size: { width: 900, height: 500 } }),
      makeNode({ id: 'group-b', type: 'group', position: { x: 1400, y: 20 }, size: { width: 900, height: 500 } }),
      makeNode({
        id: 'a-1',
        type: 'markdown',
        position: { x: 80, y: 80 },
        size: { width: 520, height: 320 },
        data: { parentGroup: 'group-a' },
      }),
      makeNode({
        id: 'a-2',
        type: 'image',
        position: { x: 80, y: 440 },
        size: { width: 520, height: 220 },
        data: { parentGroup: 'group-a' },
      }),
      makeNode({
        id: 'b-1',
        type: 'mcp-app',
        position: { x: 1480, y: 80 },
        size: { width: 760, height: 520 },
        data: { parentGroup: 'group-b' },
      }),
      makeNode({
        id: 'b-2',
        type: 'graph',
        position: { x: 1480, y: 640 },
        size: { width: 420, height: 300 },
        data: { parentGroup: 'group-b' },
      }),
    ];

    const edges: ArrangeEdge[] = [{ id: 'edge-1', from: 'a-1', to: 'b-1' }];

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
      makeNode({
        id: 'a-1',
        type: 'markdown',
        position: { x: 80, y: 80 },
        size: { width: 520, height: 320 },
        data: { parentGroup: 'group-a' },
      }),
      makeNode({
        id: 'a-2',
        type: 'image',
        position: { x: 80, y: 440 },
        size: { width: 520, height: 220 },
        data: { parentGroup: 'group-a' },
      }),
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
    expect(solo2?.x ?? 0).toBeGreaterThan(solo1?.x ?? 0);
    expect(groupA?.x ?? 0).toBeLessThan(solo1?.x ?? 0);
  });
});
