import { afterEach, beforeEach, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { AttentionToast } from '../../src/client/canvas/AttentionToast.tsx';
import { resetAttentionBridge, showToast, syncAttentionFromSse } from '../../src/client/state/attention-bridge.ts';
import { attentionHistory } from '../../src/client/state/attention-store.ts';
import { activeBoardId } from '../../src/client/state/boards-store.ts';

beforeEach(resetAttentionBridge);

afterEach(() => {
  cleanup();
  resetAttentionBridge();
  activeBoardId.value = null;
});

test('refusal reason is visible text and remains available in change history', () => {
  showToast('remove', 'Change refused', 'Node is held by the human.');
  const view = render(<AttentionToast />);
  expect(view.getByText('Node is held by the human.')).toBeTruthy();
  expect(view.getByRole('button').hasAttribute('title')).toBe(false);
  expect(attentionHistory.value[0]?.detail).toBe('Node is held by the human.');
});

test.each([undefined, 'A', 'B'])('relationship attention qualifies duplicate target ids (%s)', (toBoardId) => {
  activeBoardId.value = 'A';
  const nodes = ['s', 'x'].map((id) => ({
    id,
    type: 'markdown',
    position: { x: id === 's' ? 0 : 500, y: 0 },
    size: { width: 200, height: 100 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: id },
  }));
  const edge = { id: 'link', from: 's', to: 'x', type: 'references', ...(toBoardId ? { toBoardId } : {}) };
  const send = (edges: (typeof edge)[]) =>
    syncAttentionFromSse({
      event: 'canvas-layout-update',
      data: { boardId: 'A', layout: { nodes, edges } },
    });
  send([]);
  send([edge]);
  const expected = toBoardId === 'B' ? ['s'] : ['s', 'x'];
  expect(attentionHistory.value.find((entry) => entry.tone === 'relationship')?.nodeIds).toEqual(expected);
  send([]);
  expect(attentionHistory.value.find((entry) => entry.tone === 'remove')?.nodeIds).toEqual(expected);
});
