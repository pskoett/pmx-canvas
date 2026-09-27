import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { BoardSwitcher } from '../../src/client/canvas/BoardSwitcher.tsx';
import { HomeView } from '../../src/client/canvas/HomeView.tsx';
import { activeBoardId, boardList, boardsLoaded, type BoardSummary } from '../../src/client/state/boards-store.ts';

const realFetch = globalThis.fetch;
const calls: Array<{ url: string; init?: RequestInit }> = [];

const board = (id: string, name: string, nodeCount: number): BoardSummary => ({
  id,
  name,
  createdAt: '2026-09-01T00:00:00.000Z',
  lastOpenedAt: '2026-09-20T00:00:00.000Z',
  nodeCount,
});

beforeAll(() => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, activeBoardId: null, boards: boardList.value }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls.length = 0;
  boardList.value = [board('b-okr', 'C4 OKR planning', 26), board('b-disc', 'Discovery', 17)];
  activeBoardId.value = null;
  boardsLoaded.value = true;
});
afterEach(cleanup);

describe('Home', () => {
  test('lists boards and opens one as the human', async () => {
    const { getByText } = render(<HomeView />);
    expect(getByText('C4 OKR planning')).toBeTruthy();
    expect(getByText(/17 nodes/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(getByText('Discovery'));
    });
    const open = calls.find((call) => call.url === '/api/canvas/boards/open');
    expect(JSON.parse(String(open?.init?.body))).toEqual({ id: 'b-disc' });
    expect(new Headers(open?.init?.headers).get('X-PMX-Workbench')).toBe('1');
  });

  test('delete asks in place, naming the board and what it holds, before deleting', async () => {
    const { getAllByText, getByText, queryByText } = render(<HomeView />);
    fireEvent.click(getAllByText('Delete')[0]);
    expect(getByText(/and its 26 nodes and snapshots/)).toBeTruthy();
    expect(calls).toHaveLength(0);

    fireEvent.click(getByText('Cancel'));
    expect(queryByText(/and its 26 nodes/)).toBeNull();

    fireEvent.click(getAllByText('Delete')[0]);
    await act(async () => {
      fireEvent.click(getByText('Delete board'));
    });
    expect(calls.map((call) => [call.init?.method, call.url])).toEqual([['DELETE', '/api/canvas/boards/b-okr']]);
  });
});

describe('board switcher', () => {
  test('shows the open board and switches to a recent one or Home', async () => {
    activeBoardId.value = 'b-okr';
    const { getByRole, getByText, queryByRole } = render(<BoardSwitcher fallbackName="repo" />);
    const button = getByRole('button', { name: /Board: C4 OKR planning/ });

    fireEvent.click(button);
    // The open board is not offered as a recent board.
    expect(queryByRole('menuitem', { name: /C4 OKR planning/ })).toBeNull();
    await act(async () => {
      fireEvent.click(getByText('Discovery'));
    });
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ id: 'b-disc' });

    fireEvent.click(button);
    await act(async () => {
      fireEvent.click(getByText('All boards (Home)'));
    });
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ id: null });
  });

  test('shows the workspace name until the board list arrives', () => {
    boardsLoaded.value = false;
    const { getByRole } = render(<BoardSwitcher fallbackName="repo" />);
    expect(getByRole('button', { name: /Board: repo/ })).toBeTruthy();
  });
});
