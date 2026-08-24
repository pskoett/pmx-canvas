import { beforeEach, describe, expect, test } from 'bun:test';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { EdgeLayer } from '../../src/client/canvas/EdgeLayer.tsx';
import { activeNodeId, nodes as storeNodes, viewport } from '../../src/client/state/canvas-store.ts';
import type { CanvasEdge, CanvasNodeState } from '../../src/client/types.ts';

function node(id: string, x: number, y: number, width = 200, height = 100): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x, y },
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: id },
  };
}

describe('EdgeLayer bezier routing', () => {
  beforeEach(() => {
    activeNodeId.value = null;
    viewport.value = { x: 0, y: 0, scale: 1 };
  });

  test('edges leave a card perpendicular to its side, not along the direct line', () => {
    const a = node('a', 0, 0);
    const b = node('b', 600, 140);
    storeNodes.value = new Map([
      ['a', a],
      ['b', b],
    ]);
    const nodes = signal(storeNodes.value);
    const edges = signal(
      new Map<string, CanvasEdge>([['e1', { id: 'e1', from: 'a', to: 'b', type: 'flow' } as CanvasEdge]]),
    );

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(<EdgeLayer nodes={nodes} edges={edges} />, host);

    const d = host.querySelector('path[id^="edge-path-"]')?.getAttribute('d') ?? '';
    const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(numbers.length).toBe(8);
    const [sx, sy, c1x, c1y, c2x, c2y, ex, ey] = numbers;

    // Diagonal pair — a straight-degenerate bezier would move both control
    // points toward the other endpoint's y.
    expect(sy).not.toBeCloseTo(ey, 5);
    // Exit tangent is horizontal off the right side…
    expect(c1y).toBeCloseTo(sy, 5);
    expect(c1x).toBeGreaterThan(sx);
    // …and the entry tangent is horizontal into the left side.
    expect(c2y).toBeCloseTo(ey, 5);
    expect(c2x).toBeLessThan(ex);

    render(null, host);
    host.remove();
  });
});
