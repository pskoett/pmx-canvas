import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { BoardSwitcher } from '../../src/client/canvas/BoardSwitcher.tsx';
import { HomeView } from '../../src/client/canvas/HomeView.tsx';
import { activeBoardId, boardList, boardsLoaded, type BoardSummary } from '../../src/client/state/boards-store.ts';

const realFetch = globalThis.fetch;
const calls: Array<{ url: string; init?: RequestInit }> = [];

const board = (id: string, name: string, nodeCount: number, category: string | null = null): BoardSummary => ({
  id,
  name,
  category,
  createdAt: '2026-09-01T00:00:00.000Z',
  lastOpenedAt: '2026-09-20T00:00:00.000Z',
  nodeCount,
});

beforeAll(() => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const updated =
      init?.method === 'PATCH'
        ? boardList.value.map((entry) =>
            url.endsWith(`/${entry.id}`) ? { ...entry, ...JSON.parse(String(init.body)) } : entry,
          )
        : boardList.value;
    const openedId = url === '/api/canvas/boards/open' ? JSON.parse(String(init?.body)).id : null;
    return new Response(JSON.stringify({ ok: true, activeBoardId: openedId, boards: updated }), {
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
    const writes = () => calls.filter((call) => call.init?.method);
    fireEvent.click(getAllByText('Delete')[0]);
    expect(getByText(/and its 26 nodes and snapshots/)).toBeTruthy();
    expect(writes()).toHaveLength(0);

    fireEvent.click(getByText('Cancel'));
    expect(queryByText(/and its 26 nodes/)).toBeNull();

    fireEvent.click(getAllByText('Delete')[0]);
    await act(async () => {
      fireEvent.click(getByText('Delete board'));
    });
    expect(writes().map((call) => [call.init?.method, call.url])).toEqual([['DELETE', '/api/canvas/boards/b-okr']]);
  });
});

describe('Home categories', () => {
  test('boards are grouped by category, migrated snapshots start folded, and a board can be moved', async () => {
    localStorage.removeItem('pmx-canvas-home-collapsed');
    boardList.value = [
      board('b-okr', 'C4 OKR planning', 26, 'Planning/Quarterly'),
      board('b-loose', 'Scratch', 2),
      board('b-old', 'Before session · Copilot · 14:00', 9, 'From old snapshots'),
    ];
    const { getAllByTestId, getByRole, getByText, queryByText } = render(<HomeView />);
    expect(
      getAllByTestId('home-section').map((section) => section.querySelector('.home-section-name')?.textContent),
    ).toEqual(['From old snapshots', 'Planning', 'Quarterly']);
    expect(getByRole('region', { name: 'Unfiled boards' }).textContent).toContain('Scratch');
    expect(queryByText('Back up now')).toBeNull();
    // The migrated shelf is folded until opened.
    expect(queryByText('Before session · Copilot · 14:00')).toBeNull();
    fireEvent.click(getByRole('button', { name: /From old snapshots/ }));
    expect(getByText('Before session · Copilot · 14:00')).toBeTruthy();

    // Create a child under an implicit parent folder; it need not hold a board itself.
    const scratchRow = getByText('Scratch').closest('li') as HTMLElement;
    fireEvent.click(scratchRow.querySelector('.home-board-action') as HTMLElement);
    fireEvent.click(getByRole('radio', { name: 'Planning', exact: true }));
    fireEvent.input(getByRole('textbox', { name: 'New folder name' }), { target: { value: '../Bad' } });
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Move board', exact: true }));
    });
    expect(getByRole('alert').textContent).toContain('Use one folder name');
    expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(false);
    fireEvent.input(getByRole('textbox', { name: 'New folder name' }), { target: { value: 'Monthly' } });
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Move board', exact: true }));
    });
    const patch = calls.find((call) => call.init?.method === 'PATCH');
    expect(patch?.url).toBe('/api/canvas/boards/b-loose');
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ category: 'Planning/Monthly' });
    expect(new Headers(patch?.init?.headers).get('X-PMX-Workbench')).toBe('1');
    await waitFor(() => {
      expect(getByRole('region', { name: 'Planning/Monthly', exact: true }).textContent).toContain('Scratch');
    });
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
    // A switch also refetches board state; check the open request itself.
    const lastOpen = () => calls.filter((call) => call.url === '/api/canvas/boards/open').at(-1);
    expect(JSON.parse(String(lastOpen()?.init?.body))).toEqual({ id: 'b-disc' });

    const discoveryButton = await waitFor(() => getByRole('button', { name: /Board: Discovery/ }));
    fireEvent.click(discoveryButton);
    await act(async () => {
      fireEvent.click(getByText('All boards (Home)'));
    });
    await waitFor(() => {
      expect(JSON.parse(String(lastOpen()?.init?.body))).toEqual({ id: null });
    });
  });

  test('shows the workspace name until the board list arrives', () => {
    boardsLoaded.value = false;
    const { getByRole } = render(<BoardSwitcher fallbackName="repo" />);
    expect(getByRole('button', { name: /Board: repo/ })).toBeTruthy();
  });
});
