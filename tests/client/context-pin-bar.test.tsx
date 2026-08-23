import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { ContextPinBar } from '../../src/client/canvas/ContextPinBar.tsx';
import { closeAttentionHistory, openAttentionHistory } from '../../src/client/state/attention-store.ts';
import {
  contextPinnedNodeIds,
  createAnnotationFromClient,
  nodes,
  removeAnnotationFromClient,
  replaceContextPinsFromServer,
  toggleContextPin,
} from '../../src/client/state/canvas-store.ts';

// Clearing pins fires a best-effort (caught) sync to the server; stub fetch so
// happy-dom's relative-URL rejection doesn't spam the test output.
const realFetch = globalThis.fetch;
const calls: Array<{ url: string; init?: RequestInit }> = [];
beforeAll(() => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls.length = 0;
  contextPinnedNodeIds.value = new Set();
  nodes.value = new Map();
  closeAttentionHistory();
});

afterEach(cleanup);

describe('ContextPinBar', () => {
  test('hidden with no pins, shows live count once nodes are pinned', () => {
    const { container, getByText } = render(<ContextPinBar />);
    expect(container.innerHTML).toBe('');

    act(() => {
      replaceContextPinsFromServer(['a']);
    });
    expect(getByText(/1 node in context/)).toBeTruthy();

    act(() => {
      replaceContextPinsFromServer(['a', 'b']);
    });
    expect(getByText(/2 nodes in context/)).toBeTruthy();
  });

  test('clear button removes all pins and hides the bar', () => {
    act(() => {
      replaceContextPinsFromServer(['a', 'b']);
    });
    const { container, getByTitle } = render(<ContextPinBar />);

    act(() => {
      fireEvent.click(getByTitle('Clear all context pins'));
    });

    expect(contextPinnedNodeIds.value.size).toBe(0);
    expect(container.innerHTML).toBe('');
  });

  // Pin and annotation writes are registry ops: without the workbench marker
  // the server books the human's own click as an anonymous `api` agent and the
  // External Steering indicator lights up for it.
  test('pin and annotation writes carry the workbench marker', async () => {
    toggleContextPin('n1');
    await createAnnotationFromClient({ points: [{ x: 0, y: 0 }], color: '#fff', width: 2 });
    await removeAnnotationFromClient('ann-1');
    const urls = calls.map((call) => call.url);
    expect(urls).toEqual([
      '/api/canvas/update',
      '/api/canvas/context-pins',
      '/api/canvas/annotation',
      '/api/canvas/annotation/ann-1',
    ]);
    for (const call of calls) expect(new Headers(call.init?.headers).get('x-pmx-workbench')).toBe('1');
  });

  test('hides while the attention history overlay is open', () => {
    act(() => {
      replaceContextPinsFromServer(['a']);
    });
    const { container, getByText } = render(<ContextPinBar />);
    expect(getByText(/1 node in context/)).toBeTruthy();

    act(() => {
      openAttentionHistory();
    });
    expect(container.innerHTML).toBe('');

    act(() => {
      closeAttentionHistory();
    });
    expect(getByText(/1 node in context/)).toBeTruthy();
  });
});
