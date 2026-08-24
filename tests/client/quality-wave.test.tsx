import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { CommandPalette } from '../../src/client/canvas/CommandPalette.tsx';
import { ConnectionBanner, degradedState } from '../../src/client/canvas/ConnectionBanner.tsx';
import { EmptyState } from '../../src/client/canvas/EmptyState.tsx';
import { SelectionBar } from '../../src/client/canvas/SelectionBar.tsx';
import {
  alignSelection,
  arrangeSelection,
  connectionStatus,
  distributeSelection,
  hasInitialServerLayout,
  nodes,
  reconnectAttempt,
  reconnectDelay,
  selectNodes,
  selectedNodeIds,
  workbenchConnectionEpoch,
} from '../../src/client/state/canvas-store.ts';
import { applyPresenceSnapshot, resetPresence } from '../../src/client/state/presence-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

// rail-chrome-v2 phase 7a: empty state (11), palette (7), selection bar (13),
// degraded connection (14).

function node(
  id: string,
  x: number,
  y: number,
  width = 200,
  height = 100,
  type: CanvasNodeState['type'] = 'markdown',
): CanvasNodeState {
  return {
    id,
    type,
    position: { x, y },
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    data: { title: id },
  };
}

let calls: Array<{ url: string; init: RequestInit | undefined }>;
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, id: 'new-node', node: { id: 'new-node' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  resetPresence();
  selectedNodeIds.value = new Set();
  nodes.value = new Map([
    ['a', node('a', 100, 300)],
    ['b', node('b', 400, 120)],
    ['c', node('c', 900, 210)],
  ]);
  connectionStatus.value = 'connected';
  hasInitialServerLayout.value = true;
  workbenchConnectionEpoch.value = 1;
  reconnectAttempt.value = 0;
  reconnectDelay.value = 0;
});
afterEach(cleanup);

describe('selection geometry', () => {
  test('align left / top snap to the minimum edge; a collapsing selection flows instead of overlapping', () => {
    // a(100,300) b(400,120) c(900,210), 200×100 each. Aligning LEFT makes
    // b/c overlap vertically (120–220 vs 210–310) → the selection flows into
    // a left-aligned column in its vertical order: b, c, a.
    selectNodes(['a', 'b', 'c']);
    alignSelection('left');
    const at = (id: string) => nodes.value.get(id)!.position;
    expect([at('a').x, at('b').x, at('c').x]).toEqual([100, 100, 100]);
    expect([at('b').y, at('c').y, at('a').y]).toEqual([120, 244, 368]);
    expect(calls.some((call) => call.url === '/api/canvas/update')).toBe(true);

    // Aligning TOP of that column would fully overlap them → flows into a
    // top-aligned row (x order preserved), no node covering another.
    alignSelection('top');
    expect([at('a').y, at('b').y, at('c').y]).toEqual([120, 120, 120]);
    expect([at('a').x, at('b').x, at('c').x].sort((p, q) => p - q)).toEqual([100, 324, 548]);
  });

  test('align keeps pure edge-snapping when nothing would overlap', () => {
    // A clean vertical stack far apart: align-left just sets x, ys untouched.
    nodes.value = new Map([
      ['a', node('a', 300, 100)],
      ['b', node('b', 420, 400)],
    ]);
    selectNodes(['a', 'b']);
    alignSelection('left');
    expect(nodes.value.get('a')!.position).toEqual({ x: 300, y: 100 });
    expect(nodes.value.get('b')!.position).toEqual({ x: 300, y: 400 });
  });

  test('distribute on a selection that cannot fit flows into a row instead of squeezing into overlap', () => {
    // Three 200-wide cards in a near-column: the span between first and last
    // is far smaller than the middle card — the old math produced a negative
    // gap and stacked them.
    nodes.value = new Map([
      ['a', node('a', 100, 100)],
      ['b', node('b', 140, 260)],
      ['c', node('c', 180, 420)],
    ]);
    selectNodes(['a', 'b', 'c']);
    distributeSelection();
    const at = (id: string) => nodes.value.get(id)!.position;
    expect([at('a').x, at('b').x, at('c').x]).toEqual([100, 324, 548]);
    // No pair overlaps horizontally (200 wide + 24 gap).
    expect(at('b').x - at('a').x).toBeGreaterThanOrEqual(224);
    expect(at('c').x - at('b').x).toBeGreaterThanOrEqual(224);
  });

  test('distribute evens the horizontal gaps, first and last staying put', () => {
    selectNodes(['a', 'b', 'c']);
    distributeSelection();
    const [a, b, c] = ['a', 'b', 'c'].map((id) => nodes.value.get(id)!);
    expect(a.position.x).toBe(100);
    expect(c.position.x).toBe(900);
    // span between a's right edge (300) and c's left edge (900) = 600; b is 200 wide → gaps of 200.
    expect(b.position.x).toBe(500);
  });

  test('arrange grids the selection from its own top-left in reading order', () => {
    nodes.value = new Map([
      ['a', node('a', 100, 300)],
      ['b', node('b', 400, 120)],
      ['c', node('c', 900, 210)],
      ['d', node('d', 50, 800)],
    ]);
    selectNodes(['a', 'b', 'c', 'd']);
    arrangeSelection(24);
    const pos = (id: string) => nodes.value.get(id)!.position;
    // reading order: b (y120), c (y210), a (y300), d (y800); 2 columns; origin (50,120)
    expect(pos('b')).toEqual({ x: 50, y: 120 });
    expect(pos('c')).toEqual({ x: 274, y: 120 });
    expect(pos('a')).toEqual({ x: 50, y: 244 });
    expect(pos('d')).toEqual({ x: 274, y: 244 });
  });

  test('the bar exposes the geometry actions for a multi-selection and deletes through the server', () => {
    act(() => selectNodes(['a', 'b', 'c']));
    const { getByLabelText, getByText } = render(<SelectionBar />);
    expect(getByLabelText('Align left')).toBeTruthy();
    expect(getByLabelText('Distribute')).toBeTruthy();
    expect(getByLabelText('Auto-arrange')).toBeTruthy();
    expect(getByText('Group')).toBeTruthy();
    fireEvent.click(getByLabelText('Delete selection'));
    expect(nodes.value.size).toBe(0);
    expect(selectedNodeIds.value.size).toBe(0);
    expect(calls.filter((call) => call.init?.method === 'DELETE')).toHaveLength(3);
  });
});

describe('empty state', () => {
  test('offers the four starter actions; New note creates the same blank note as M', async () => {
    const { getByText, getByTestId } = render(<EmptyState onOpenPalette={() => {}} />);
    expect(getByTestId('empty-state').textContent).toContain('Nothing on this board yet');
    for (const label of ['New markdown note', 'Drop files', 'Paste a link', 'Start agent session']) {
      expect(getByText(label)).toBeTruthy();
    }
    fireEvent.click(getByText('New markdown note'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const create = calls.find((call) => call.url === '/api/canvas/node');
    expect(create?.init?.method).toBe('POST');
    expect(JSON.parse(String(create?.init?.body))).toMatchObject({ type: 'markdown', title: 'New note' });
  });

  test('Start agent session attaches a browser-keyed session', async () => {
    const { getByText } = render(<EmptyState onOpenPalette={() => {}} />);
    fireEvent.click(getByText('Start agent session'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const attach = calls.find((call) => call.url === '/api/canvas/ax/presence');
    expect(JSON.parse(String(attach?.init?.body))).toMatchObject({ source: 'browser', attached: true });
  });
});

describe('command palette', () => {
  test('groups Actions before Jump to, shows shortcuts, and offers Start agent session only off-session', () => {
    const { container, rerender } = render(<CommandPalette onClose={() => {}} onToggleMinimap={() => {}} />);
    const groups = [...container.querySelectorAll('.command-palette-group')].map((el) => el.textContent);
    expect(groups).toEqual(['Actions', 'Jump to']);
    const labels = [...container.querySelectorAll('.command-palette-item')].map((el) => el.textContent);
    expect(labels[0]).toContain('New markdown note');
    expect(labels[0]).toContain('M');
    expect(labels.some((label) => label?.includes('Start agent session'))).toBe(true);
    expect(labels.some((label) => label?.includes('a — md'))).toBe(true);

    act(() =>
      applyPresenceSnapshot({
        presences: [
          {
            sessionId: 'browser',
            source: 'browser',
            agentId: null,
            label: 'Agent session',
            phase: 'idle',
            detail: null,
            focusNodeId: null,
            cursor: null,
            attached: true,
            opCount: 0,
            contextUsage: null,
            lastSeenAt: new Date().toISOString(),
          },
        ],
      }),
    );
    rerender(<CommandPalette onClose={() => {}} onToggleMinimap={() => {}} />);
    const after = [...container.querySelectorAll('.command-palette-item')].map((el) => el.textContent);
    expect(after.some((label) => label?.includes('Start agent session'))).toBe(false);
  });
});

describe('degraded connection', () => {
  test('derives reconnecting from a dropped transport and resyncing from a post-reconnect snapshot', () => {
    expect(degradedState.value).toBeNull();
    connectionStatus.value = 'disconnected';
    reconnectAttempt.value = 2;
    reconnectDelay.value = 1000;
    expect(degradedState.value).toBe('reconnecting');
    const { container, rerender } = render(<ConnectionBanner />);
    expect(container.querySelector('.connection-banner')?.className).toContain('is-reconnecting');
    expect(container.querySelector('.connection-banner-meta')?.textContent).toBe('retry 2 · 1s');

    // The stream returns: the bridge drops the cursor and reloads the snapshot.
    connectionStatus.value = 'connected';
    hasInitialServerLayout.value = false;
    workbenchConnectionEpoch.value = 2;
    expect(degradedState.value).toBe('resyncing');
    rerender(<ConnectionBanner />);
    expect(container.querySelector('.connection-banner')?.className).toContain('is-resyncing');

    hasInitialServerLayout.value = true;
    expect(degradedState.value).toBeNull();
    rerender(<ConnectionBanner />);
    expect(container.innerHTML).toBe('');
  });

  test('first boot never shows a banner', () => {
    connectionStatus.value = 'connecting';
    hasInitialServerLayout.value = false;
    workbenchConnectionEpoch.value = 0;
    expect(degradedState.value).toBeNull();
    connectionStatus.value = 'connected';
    workbenchConnectionEpoch.value = 1;
    expect(degradedState.value).toBeNull();
  });
});
