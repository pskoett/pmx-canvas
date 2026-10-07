import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { BoardPinButton } from '../../src/client/canvas/BoardPinButton.tsx';
import { type BoardSummary, boardList } from '../../src/client/state/boards-store.ts';

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
  boardList.value = [];
});
afterEach(cleanup);

const board = (pin: BoardSummary['pin']): BoardSummary => ({
  id: 'board-research',
  name: 'Research',
  category: null,
  createdAt: '2026-10-07T00:00:00.000Z',
  lastOpenedAt: null,
  nodeCount: 3,
  pin,
});

describe('BoardPinButton', () => {
  test('pins an unpinned board as the human, with the workbench marker', async () => {
    const { getByTestId } = render(<BoardPinButton board={board(null)} />);
    const button = getByTestId('board-pin');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe("Pin board to the agent's context");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(calls.at(-1)?.url).toBe('/api/canvas/boards/board-research/pin');
    expect(new Headers(calls.at(-1)?.init?.headers).get('x-pmx-workbench')).toBe('1');
  });

  test('a pinned board unpins, and an agent pin shows the violet dot', async () => {
    const pinned = board({ pinnedBy: { actor: 'agent', source: 'mcp' }, pinnedAt: '2026-10-07T00:00:00.000Z' });
    const { getByTestId, container } = render(<BoardPinButton board={pinned} />);
    expect(getByTestId('board-pin').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.ctx-pin-agent-dot')).toBeTruthy();
    await act(async () => {
      fireEvent.click(getByTestId('board-pin'));
    });
    expect(calls.at(-1)?.url).toBe('/api/canvas/boards/board-research/unpin');
  });
});
