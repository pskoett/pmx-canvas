import { describe, expect, test } from 'bun:test';
import { computeAutoFitHeight, shouldAutoFitNode } from '../../src/client/canvas/auto-fit.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeNode(overrides: Partial<CanvasNodeState> & Pick<CanvasNodeState, 'type'>): CanvasNodeState {
  return {
    id: 'auto-fit-test',
    type: overrides.type,
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 760, height: 520 },
    zIndex: overrides.zIndex ?? 1,
    collapsed: overrides.collapsed ?? false,
    pinned: overrides.pinned ?? false,
    dockPosition: overrides.dockPosition ?? null,
    data: overrides.data ?? {},
  };
}

describe('client auto-fit helpers', () => {
  test('does not shrink structured graph and json-render frames', () => {
    const graph = makeNode({ type: 'graph', size: { width: 480, height: 380 } });
    const jsonRender = makeNode({ type: 'json-render', size: { width: 900, height: 420 } });

    expect(shouldAutoFitNode(graph)).toBe(false);
    expect(shouldAutoFitNode(jsonRender)).toBe(false);
    expect(computeAutoFitHeight(graph, 120)).toBeNull();
    expect(computeAutoFitHeight(jsonRender, 160)).toBeNull();
  });

  test('still caps regular content auto-fit at 600px', () => {
    const markdown = makeNode({ type: 'markdown', size: { width: 360, height: 200 } });

    expect(computeAutoFitHeight(markdown, 900)).toBe(600);
  });
});
