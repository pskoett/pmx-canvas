import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { restoreViewerRuntimeState } from '../../src/client/nodes/viewer-runtime-state.ts';
import { canvasInteractionEpoch, nodes } from '../../src/client/state/canvas-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';
import { JSON_VIEWER_STATE_SOURCE } from '../../src/shared/ax-surface-protocol.ts';

const node: CanvasNodeState = {
  id: 'form',
  type: 'json-render',
  position: { x: 0, y: 0 },
  size: { width: 560, height: 340 },
  zIndex: 1,
  collapsed: false,
  pinned: false,
  data: { specVersion: 1 },
};
const frame = () => {
  const postMessage = mock((_message: { state: unknown }, _origin: string) => {});
  return { source: { postMessage } as unknown as Window, postMessage };
};
const emit = (source: Window, token: string, state: unknown, nodeId = node.id, tag = JSON_VIEWER_STATE_SOURCE) => {
  window.dispatchEvent(
    new MessageEvent('message', {
      source,
      data: { source: tag, type: 'snapshot', token, nodeId, state },
    }),
  );
};

beforeEach(() => {
  nodes.value = new Map([[node.id, node]]);
});
afterEach(() => {
  nodes.value = new Map();
});

test('handoffs retain complete snapshots, without AX state or stale retired-frame writes', () => {
  const inline = frame();
  restoreViewerRuntimeState(node.id, 'inline', inline.source);
  expect(inline.postMessage.mock.calls.at(-1)?.[0].state).toBeNull();
  emit(inline.source, 'inline', { draft: 'first', tasks: [17, 43], ax: { private: 'not a draft' } });
  // A queued input from a now-unmounted frame is still received before the next load.
  emit(inline.source, 'inline', { draft: 'last input', tasks: [17, 43] });
  const expanded = frame();
  restoreViewerRuntimeState(node.id, 'expanded', expanded.source);
  expect(expanded.postMessage.mock.calls.at(-1)?.[0].state).toEqual({ draft: 'last input', tasks: [17, 43] });
  emit(expanded.source, 'expanded', { tasks: [28], ax: { stale: true } });
  emit(inline.source, 'inline', { draft: 'obsolete' });
  const returned = frame();
  restoreViewerRuntimeState(node.id, 'returned', returned.source);
  // No merging: the removed draft key and the old list must stay removed.
  expect(returned.postMessage.mock.calls.at(-1)?.[0].state).toEqual({ tasks: [28] });
});

test('nonce, source window, node ID, protocol and snapshot shape are all checked', () => {
  const owner = frame();
  const stranger = frame();
  restoreViewerRuntimeState(node.id, 'secret', owner.source);
  emit(owner.source, 'secret', { draft: 'valid' });
  emit(stranger.source, 'secret', { draft: 'foreign frame' });
  emit(owner.source, 'wrong', { draft: 'wrong token' });
  emit(owner.source, 'secret', { draft: 'wrong node' }, 'other');
  emit(owner.source, 'secret', { draft: 'wrong tag' }, node.id, 'wrong');
  for (const state of [null, [], 'invalid', 12]) emit(owner.source, 'secret', state);
  restoreViewerRuntimeState(node.id, 'next', stranger.source);
  expect(stranger.postMessage.mock.calls.at(-1)?.[0].state).toEqual({ draft: 'valid' });
});

for (const reset of ['revision', 'document URL', 'navigation', 'removal']) {
  test(`${reset} discards state and rejects old-frame messages even if the node ID is reused`, () => {
    const old = frame();
    restoreViewerRuntimeState(node.id, 'old', old.source);
    emit(old.source, 'old', { draft: 'discard me' });
    if (reset === 'revision') nodes.value = new Map([[node.id, { ...node, data: { specVersion: 2 } }]]);
    if (reset === 'document URL')
      nodes.value = new Map([[node.id, { ...node, data: { ...node.data, url: 'https://other.example/view' } }]]);
    if (reset === 'navigation') canvasInteractionEpoch.value += 1;
    if (reset === 'removal') {
      nodes.value = new Map();
      nodes.value = new Map([[node.id, node]]);
    }
    const next = frame();
    restoreViewerRuntimeState(node.id, 'new', next.source);
    emit(old.source, 'old', { draft: 'late obsolete input' });
    restoreViewerRuntimeState(node.id, 'new', next.source);
    expect(next.postMessage.mock.calls.at(-1)?.[0].state).toBeNull();
  });
}
