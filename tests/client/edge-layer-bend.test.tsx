import { beforeEach, describe, expect, test } from 'bun:test';
import { signal } from '@preact/signals';
import { render } from 'preact';
import { EdgeLayer } from '../../src/client/canvas/EdgeLayer.tsx';
import {
  activeNodeId,
  clearSelection,
  selectedEdgeId,
  nodes as storeNodes,
  viewport,
} from '../../src/client/state/canvas-store.ts';
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

describe('edge labels at overview zoom', () => {
  test('labels cap at the node-chrome scale and vanish once the board is slivers', () => {
    const a = node('a', 0, 0);
    const b = node('b', 800, 40);
    storeNodes.value = new Map([
      ['a', a],
      ['b', b],
    ]);
    const nodes = signal(storeNodes.value);
    const edges = signal(
      new Map<string, CanvasEdge>([
        ['e1', { id: 'e1', from: 'a', to: 'b', type: 'flow', label: 'brief' } as CanvasEdge],
      ]),
    );
    const host = document.createElement('div');
    document.body.appendChild(host);

    // Working zoom (50% → chrome scale 2): label present, capped var ≤ 2.2.
    viewport.value = { x: 0, y: 0, scale: 0.5 };
    render(<EdgeLayer nodes={nodes} edges={edges} />, host);
    expect(host.querySelector('.edge-label')?.textContent).toBe('brief');
    const svg = host.querySelector('svg') as SVGElement;
    expect(Number(svg.style.getPropertyValue('--edge-label-scale'))).toBeLessThanOrEqual(2.2);

    // Overview zoom (20% → chrome scale 5): the label is dropped entirely —
    // it used to render bigger than the nodes it connected — and the
    // arrowhead caps at the node-chrome scale instead of riding the uncapped
    // stroke compensation.
    viewport.value = { x: 0, y: 0, scale: 0.2 };
    render(<EdgeLayer nodes={nodes} edges={edges} />, host);
    expect(host.querySelector('.edge-label')).toBeNull();
    const marker = host.querySelector('marker#edge-arrow') as SVGElement;
    expect(marker.getAttribute('markerUnits')).toBe('userSpaceOnUse');
    expect(Number(marker.getAttribute('markerWidth'))).toBeCloseTo(8 * 2.2, 5);
    render(null, host);
    host.remove();
  });
});

describe('edge interactivity', () => {
  test('right-clicking the hitbox opens the edge menu with the edge id', () => {
    const a = node('a', 0, 0);
    const b = node('b', 700, 60);
    storeNodes.value = new Map([
      ['a', a],
      ['b', b],
    ]);
    viewport.value = { x: 0, y: 0, scale: 1 };
    const nodes = signal(storeNodes.value);
    const edges = signal(
      new Map<string, CanvasEdge>([['e9', { id: 'e9', from: 'a', to: 'b', type: 'relation' } as CanvasEdge]]),
    );
    const seen: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(<EdgeLayer nodes={nodes} edges={edges} onEdgeContextMenu={(_e, id) => seen.push(id)} />, host);
    const hitbox = host.querySelector('path[stroke="transparent"]') as SVGPathElement;
    expect(hitbox).not.toBeNull();
    hitbox.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(seen).toEqual(['e9']);
    render(null, host);
    host.remove();
  });

  test('clicking the hitbox selects the edge (keyboard-delete parity) and clearSelection releases it', () => {
    const a = node('a', 0, 0);
    const b = node('b', 700, 60);
    storeNodes.value = new Map([
      ['a', a],
      ['b', b],
    ]);
    viewport.value = { x: 0, y: 0, scale: 1 };
    const nodes = signal(storeNodes.value);
    const edges = signal(
      new Map<string, CanvasEdge>([['e9', { id: 'e9', from: 'a', to: 'b', type: 'relation' } as CanvasEdge]]),
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(<EdgeLayer nodes={nodes} edges={edges} />, host);
    const hitbox = host.querySelector('path[stroke="transparent"]') as SVGPathElement;
    hitbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterClick: string | null = selectedEdgeId.value;
    expect(afterClick).toBe('e9');
    render(<EdgeLayer nodes={nodes} edges={edges} />, host);
    // The visible path advertises the selection (bolder stroke, full opacity).
    expect(host.querySelector('path.edge-selected')?.id).toBe('edge-path-e9');
    clearSelection();
    const afterClear: string | null = selectedEdgeId.value;
    expect(afterClear).toBeNull();
    render(null, host);
    host.remove();
  });
});

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
