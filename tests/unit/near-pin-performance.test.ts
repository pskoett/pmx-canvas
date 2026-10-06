import { describe, expect, test } from 'bun:test';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';
import { findNeighborhoods } from '../../src/server/spatial-analysis.ts';

// Near a pin runs on every drag frame (plan 016, slice 4 performance budget).
// Measured 2026-10-06: 0.8 ms at 1,000 nodes / 40 pins. The bound is generous so
// it cannot flake on a loaded machine, but it catches an accidental blow-up.

function board(count: number): CanvasNodeState[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    type: 'markdown',
    position: { x: (index % 20) * 420, y: Math.floor(index / 20) * 300 },
    size: { width: 360, height: 200 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: `n${index}` },
  }));
}

describe('near a pin: neighbour calculation budget', () => {
  test('1,000 nodes and 40 pins stay well inside one frame', () => {
    const nodes = board(1000);
    const pins = new Set(Array.from({ length: 40 }, (_, index) => `n${index * 7}`));
    for (let i = 0; i < 10; i++) findNeighborhoods(nodes, pins);
    const runs = 50;
    const start = performance.now();
    for (let i = 0; i < runs; i++) findNeighborhoods(nodes, pins);
    expect((performance.now() - start) / runs).toBeLessThan(8);
  });
});
