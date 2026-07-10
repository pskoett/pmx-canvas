import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { ContextPinBar } from '../../src/client/canvas/ContextPinBar.tsx';
import { closeAttentionHistory, openAttentionHistory } from '../../src/client/state/attention-store.ts';
import {
  contextPinnedNodeIds,
  nodes,
  replaceContextPinsFromServer,
  toggleCollapsed,
} from '../../src/client/state/canvas-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeContextNode(overrides: Partial<CanvasNodeState> = {}): CanvasNodeState {
  return {
    id: 'ctx-panel',
    type: 'context',
    position: { x: 0, y: 0 },
    size: { width: 320, height: 400 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: 'right',
    data: {},
    ...overrides,
  };
}

// Clearing pins fires a best-effort (caught) sync to the server; stub fetch so
// happy-dom's relative-URL rejection doesn't spam the test output.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
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

  test('hides while a docked context panel is expanded', () => {
    act(() => {
      nodes.value = new Map([['ctx-panel', makeContextNode()]]);
      replaceContextPinsFromServer(['ctx-panel']);
    });
    const { container, getByText } = render(<ContextPinBar />);
    expect(container.innerHTML).toBe('');

    act(() => {
      toggleCollapsed('ctx-panel');
    });
    expect(getByText(/1 node in context/)).toBeTruthy();
  });
});
