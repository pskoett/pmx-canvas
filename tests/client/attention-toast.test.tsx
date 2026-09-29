import { afterEach, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/preact';
import { AttentionToast } from '../../src/client/canvas/AttentionToast.tsx';
import { resetAttentionBridge, showToast } from '../../src/client/state/attention-bridge.ts';
import { attentionHistory } from '../../src/client/state/attention-store.ts';

afterEach(() => {
  cleanup();
  resetAttentionBridge();
});

test('refusal reason is visible text and remains available in change history', () => {
  showToast('remove', 'Change refused', 'Node is held by the human.');
  const view = render(<AttentionToast />);
  expect(view.getByText('Node is held by the human.')).toBeTruthy();
  expect(view.getByRole('button').hasAttribute('title')).toBe(false);
  expect(attentionHistory.value[0]?.detail).toBe('Node is held by the human.');
});
