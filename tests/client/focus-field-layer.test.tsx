import { beforeEach, describe, expect, test } from 'bun:test';
import { render } from 'preact';
import { FocusFieldLayer } from '../../src/client/canvas/FocusFieldLayer.tsx';
import { nodes } from '../../src/client/state/canvas-store.ts';
import { attentionRegions, resetAttentionState, setAttentionFocus } from '../../src/client/state/attention-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

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

function mount(): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(<FocusFieldLayer />, host);
  return host;
}

describe('FocusFieldLayer regions', () => {
  beforeEach(() => {
    resetAttentionState();
    nodes.value = new Map([
      ['a', node('a', 0, 0)],
      ['b', node('b', 300, 0)],
      ['c', node('c', 2400, 1400)],
    ]);
  });

  test('renders a glow for a compact region', () => {
    setAttentionFocus(['a'], ['b'], [{ id: 'r1', primaryNodeId: 'a', nodeIds: ['a', 'b'] }]);
    const host = mount();
    expect(host.querySelectorAll('.attention-field-region').length).toBe(1);
    expect(host.querySelectorAll('.attention-field-primary').length).toBe(1);
    render(null, host);
    host.remove();
  });

  test('skips a region that spans (nearly) the whole board, keeps node halos', () => {
    setAttentionFocus(['a'], [], [{ id: 'r1', primaryNodeId: 'a', nodeIds: ['a', 'c'] }]);
    expect(attentionRegions.value.length).toBe(1);
    const host = mount();
    expect(host.querySelectorAll('.attention-field-region').length).toBe(0);
    expect(host.querySelectorAll('.attention-field-primary').length).toBe(1);
    render(null, host);
    host.remove();
  });
});
