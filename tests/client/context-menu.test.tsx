import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { ContextMenu, type MenuState } from '../../src/client/canvas/ContextMenu.tsx';
import {
  activeNodeId,
  contextPinnedNodeIds,
  edges,
  nodes,
  pendingConnection,
} from '../../src/client/state/canvas-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

function makeNode(id: string, overrides: Partial<CanvasNodeState> = {}): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x: 0, y: 0 },
    size: { width: 520, height: 360 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: {},
    ...overrides,
  };
}

function nodeMenu(nodeId: string): MenuState {
  return { kind: 'node', x: 20, y: 20, nodeId };
}

beforeEach(() => {
  nodes.value = new Map();
  edges.value = new Map();
  contextPinnedNodeIds.value = new Set();
  pendingConnection.value = null;
  activeNodeId.value = null;
});

afterEach(cleanup);

describe('edge context menu', () => {
  test('an edge menu offers exactly one thing: Delete edge (danger), which fires the DELETE', () => {
    const calls: Array<{ req: string; body: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ req: `${init?.method ?? 'GET'} ${String(input)}`, body: String(init?.body ?? '') });
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    try {
      const menu: MenuState = { kind: 'edge', x: 40, y: 40, edgeId: 'edge-xyz' };
      const { getByText } = render(<ContextMenu menu={menu} onClose={() => {}} />);
      const label = getByText('Delete edge');
      const item = label.closest('.context-menu-item') as HTMLElement;
      expect(item.className).toContain('is-danger');
      fireEvent.click(item);
      const del = calls.find((c) => c.req === 'DELETE /api/canvas/edge');
      expect(del).toBeDefined();
      expect(del!.body).toContain('edge-xyz');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('ContextMenu', () => {
  test('renders nothing for a node menu whose node is gone from the store', () => {
    const { container } = render(<ContextMenu menu={nodeMenu('ghost')} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  test('node menu lists the core actions for a markdown node', () => {
    nodes.value = new Map([['n1', makeNode('n1')]]);
    const { getByText } = render(<ContextMenu menu={nodeMenu('n1')} onClose={() => {}} />);

    expect(getByText('Focus')).toBeTruthy();
    expect(getByText('Expand')).toBeTruthy();
    expect(getByText('Collapse')).toBeTruthy();
    expect(getByText('Pin as context')).toBeTruthy();
    expect(getByText('Lock position (no auto-arrange)')).toBeTruthy();
    expect(getByText('Connect from here')).toBeTruthy();
    expect(getByText('Delete')).toBeTruthy();
  });

  test('offers unpin when the node is already context-pinned', () => {
    nodes.value = new Map([['n1', makeNode('n1')]]);
    contextPinnedNodeIds.value = new Set(['n1']);
    const { getByText, queryByText } = render(<ContextMenu menu={nodeMenu('n1')} onClose={() => {}} />);

    expect(getByText('Unpin from context')).toBeTruthy();
    expect(queryByText('Pin as context')).toBeNull();
  });

  test('connect from here arms a pending connection and offers it on the next node menu', () => {
    nodes.value = new Map([
      ['n1', makeNode('n1', { data: { title: 'Note A' } })],
      ['n2', makeNode('n2')],
    ]);
    const onClose = mock(() => {});

    const first = render(<ContextMenu menu={nodeMenu('n1')} onClose={onClose} />);
    act(() => {
      fireEvent.click(first.getByText('Connect from here'));
    });

    expect(pendingConnection.value).toEqual({ from: 'n1' });
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    const second = render(<ContextMenu menu={nodeMenu('n2')} onClose={() => {}} />);
    expect(second.getByText('Connect from "Note A"')).toBeTruthy();
    expect(second.getByText('Connect from here (replace)')).toBeTruthy();
  });

  test('canvas menu lists the creation actions', () => {
    const { getByText } = render(
      <ContextMenu menu={{ kind: 'canvas', x: 20, y: 20, canvasX: 100, canvasY: 100 }} onClose={() => {}} />,
    );

    expect(getByText('New note')).toBeTruthy();
    expect(getByText('Open webpage...')).toBeTruthy();
    expect(getByText('Open file...')).toBeTruthy();
    expect(getByText('Open image...')).toBeTruthy();
    expect(getByText('New group')).toBeTruthy();
  });
});
