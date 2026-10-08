import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { ContextChip } from '../../src/client/canvas/ContextChip.tsx';
import { activeBoardId, type BoardSummary, boardList } from '../../src/client/state/boards-store.ts';
import { contextPinnedNodeIds, nodes } from '../../src/client/state/canvas-store.ts';
import { briefSize, pinnedBoardReads } from '../../src/client/state/context-chip-store.ts';
import { applyContextStatus } from '../../src/client/state/context-status-store.ts';
import { applyPresenceSnapshot, resetPresence } from '../../src/client/state/presence-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

// docs/design/ContextChip.dc.html: the one chip in the top bar, in brief order
// (cards · near · boards) with what the brief costs in tokens; details on click.

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

function card(id: string, x: number, title = id): CanvasNodeState {
  return {
    id,
    type: 'markdown',
    position: { x, y: 0 },
    size: { width: 200, height: 120 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    contentRevision: 1,
    data: { title },
  };
}

const board = (id: string, name: string, pin: BoardSummary['pin'] = null): BoardSummary => ({
  id,
  name,
  category: null,
  createdAt: '2026-10-07T00:00:00.000Z',
  lastOpenedAt: null,
  nodeCount: 3,
  pin,
});

const human = { actor: 'human' as const, source: 'browser' };
const agent = { actor: 'agent' as const, source: 'mcp', agentId: 'claude' };

beforeEach(() => {
  calls.length = 0;
  activeBoardId.value = 'open';
  boardList.value = [board('open', 'Pricing research')];
  nodes.value = new Map();
  contextPinnedNodeIds.value = new Set();
  briefSize.value = null;
  pinnedBoardReads.value = new Map();
  applyContextStatus({});
});
afterEach(() => {
  cleanup();
  resetPresence();
});

describe('ContextChip', () => {
  test('nothing pinned: a quiet chip that opens a one-line how-to', () => {
    const { getByTestId, getByText } = render(<ContextChip />);
    expect(getByTestId('context-chip').textContent).toContain('Nothing in context');
    expect(getByTestId('context-chip').className).toContain('is-empty');
    fireEvent.click(getByTestId('context-chip'));
    expect(getByText(/Nothing is pinned/)).toBeTruthy();
  });

  test('counts cards, near and boards in brief order, with the token cost', () => {
    nodes.value = new Map([
      ['a', card('a', 0, 'Raise Team to $24?')],
      ['b', card('b', 300, 'Churn flat after last raise')],
      ['far', card('far', 5000)],
    ]);
    contextPinnedNodeIds.value = new Set(['a']);
    boardList.value = [
      board('open', 'Pricing research'),
      board('tech', 'Tech Enabling — overview', { pinnedBy: human, pinnedAt: '2026-10-07T00:00:00.000Z' }),
    ];
    briefSize.value = { chars: 4_400 };
    const { getByTestId } = render(<ContextChip />);
    const chip = getByTestId('context-chip').querySelector('.context-chip-wide')!;
    expect(chip.textContent).toBe('1 card · 1 near · 1 board');
    expect(chip.querySelector('.is-near')?.textContent).toContain('1 near');
    expect(getByTestId('token-cost').textContent).toBe('≈ 1.1k tokens');
  });

  test('a cost, never a budget: no share, meter or clipped state; agent-only pins carry the violet dot', () => {
    nodes.value = new Map([['a', card('a', 0)]]);
    contextPinnedNodeIds.value = new Set(['a']);
    applyContextStatus({ pins: { a: { pinnedBy: agent, pinnedAt: '2026-10-07T00:00:00.000Z' } } });
    briefSize.value = { chars: 64_000 };
    const { getByTestId, getByRole, container } = render(<ContextChip />);
    expect(getByTestId('token-cost').textContent).toBe('≈ 16.0k tokens');
    expect(getByTestId('context-chip').textContent).not.toMatch(/%|over|clipped|budget/);
    fireEvent.click(getByTestId('context-chip'));
    expect(getByRole('dialog').textContent).not.toMatch(/%|clipped|budget/);
    expect(container.querySelector('.context-chip .context-chip-agent-dot')).toBeTruthy();
    expect(getByTestId('context-chip').textContent).toContain('by claude');
  });

  test('opened: unpin, clear all and promoting a near card all go through the workbench bridge', async () => {
    nodes.value = new Map([
      ['a', card('a', 0, 'Raise Team to $24?')],
      ['b', card('b', 300, 'Churn flat after last raise')],
    ]);
    contextPinnedNodeIds.value = new Set(['a']);
    boardList.value = [
      board('open', 'Pricing research'),
      board('tech', 'Tech Enabling — overview', { pinnedBy: human, pinnedAt: '2026-10-07T00:00:00.000Z' }),
    ];
    pinnedBoardReads.value = new Map([['tech', null]]);
    const { getByTestId, getByText, getByRole, getAllByText } = render(<ContextChip />);
    fireEvent.click(getByTestId('context-chip'));
    expect(getByRole('dialog').textContent).toContain('In the agent’s context');
    expect(getByText('Tech Enabling — overview')).toBeTruthy();
    expect(getAllByText('not read yet').length).toBeGreaterThan(0);
    expect(getByText('near Raise Team to $24?')).toBeTruthy();

    await act(async () => {
      fireEvent.click(getByText('Pin'));
    });
    expect(contextPinnedNodeIds.value.has('b')).toBe(true);

    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Unpin Tech Enabling — overview' }));
    });
    expect(calls.some((call) => call.url === '/api/canvas/boards/tech/unpin')).toBe(true);

    await act(async () => {
      fireEvent.click(getByText('Clear all'));
    });
    expect(contextPinnedNodeIds.value.size).toBe(0);
    const writes = calls.filter((call) => call.init?.method && call.init.method !== 'GET');
    expect(writes.length).toBeGreaterThan(0);
    for (const call of writes) expect(new Headers(call.init?.headers).get('x-pmx-workbench')).toBe('1');
  });

  test('a pinned card whose links changed after the read lists "links changed" in neutral, not amber', () => {
    nodes.value = new Map([['a', { ...card('a', 0, 'Raise Team to $24?'), linksRevision: 9 }]]);
    contextPinnedNodeIds.value = new Set(['a']);
    applyContextStatus({
      nodes: [
        { nodeId: 'a', lastReadAt: '2026-10-08T00:00:00.000Z', lastReadBy: 'codex', readRevision: 1, readCount: 1 },
      ],
      links: { a: 4 },
      pins: { a: { pinnedBy: human, pinnedAt: '2026-10-07T00:00:00.000Z' } },
    });
    const { getByTestId, container } = render(<ContextChip />);
    fireEvent.click(getByTestId('context-chip'));
    expect(container.querySelector('.context-tag.is-links')?.textContent).toContain('links changed');
    expect(container.querySelector('.context-tag.is-changed')).toBeNull();
  });

  test("a host that reports its agent's tokens is named with that count, as a plain number", () => {
    nodes.value = new Map([['a', card('a', 0)]]);
    contextPinnedNodeIds.value = new Set(['a']);
    briefSize.value = { chars: 4_400 };
    applyPresenceSnapshot({
      presences: [
        {
          sessionId: 'copilot',
          source: 'copilot',
          agentId: null,
          label: 'Copilot',
          phase: 'idle',
          detail: null,
          focusNodeId: null,
          cursor: null,
          attached: true,
          opCount: 0,
          contextUsage: { used: 42_800, total: 128_000 },
          lastSeenAt: '2026-10-08T00:00:00.000Z',
        },
      ],
    });
    const { getByTestId, getByRole } = render(<ContextChip />);
    expect(getByTestId('token-cost').textContent).toBe('≈ 1.1k tokens');
    fireEvent.click(getByTestId('context-chip'));
    expect(getByRole('dialog').textContent).toContain(
      'What the canvas sends the agent costs ≈ 1.1k tokens. Copilot’s whole context holds 42.8k tokens.',
    );
    expect(getByRole('dialog').textContent).not.toContain('%');
  });

  test('Escape closes the panel', () => {
    const { getByTestId, queryByRole } = render(<ContextChip />);
    fireEvent.click(getByTestId('context-chip'));
    expect(queryByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
  });
});
