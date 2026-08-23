import { describe, expect, test } from 'bun:test';
import { getRenderableWorldNodes } from '../../src/client/canvas/CanvasViewport.tsx';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeNode(id: string, type: CanvasNodeState['type']): CanvasNodeState {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: {},
  };
}

describe('CanvasViewport world node selection', () => {
  test('omits the expanded node from the world layer', () => {
    const nodes = [makeNode('group-1', 'group'), makeNode('app-1', 'mcp-app'), makeNode('md-1', 'markdown')];

    expect(getRenderableWorldNodes(nodes, 'app-1').map((node) => node.id)).toEqual(['group-1', 'md-1']);
  });

  test('renders every node, groups first', () => {
    const nodes = [
      makeNode('md-1', 'markdown'),
      makeNode('ctx-1', 'context'),
      makeNode('group-1', 'group'),
      makeNode('img-1', 'image'),
    ];

    expect(getRenderableWorldNodes(nodes, null).map((node) => node.id)).toEqual(['group-1', 'md-1', 'ctx-1', 'img-1']);
  });
});
