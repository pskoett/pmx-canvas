import { describe, expect, test } from 'bun:test';
import { getStatusDisplayPhase } from '../../src/client/nodes/StatusNode.tsx';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeStatusNode(data: Record<string, unknown>): CanvasNodeState {
  return {
    id: 'status-test',
    type: 'status',
    position: { x: 0, y: 0 },
    size: { width: 320, height: 180 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  };
}

describe('StatusNode display phase', () => {
  test('uses content as rendered status text when phase is absent', () => {
    expect(getStatusDisplayPhase(makeStatusNode({ content: 'passing' }))).toBe('passing');
  });

  test('keeps phase as the primary status display field', () => {
    expect(getStatusDisplayPhase(makeStatusNode({ phase: 'running', content: 'passing' }))).toBe('running');
  });
});
