import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { BoardSwitcher } from '../../src/client/canvas/BoardSwitcher.tsx';
import { HomeView } from '../../src/client/canvas/HomeView.tsx';
import { KnowledgeDialog } from '../../src/client/canvas/KnowledgeDialog.tsx';
import { memoryKey, type MemoryGraph } from '../../src/shared/memory-graph.ts';
import type { LifecycleQualification } from '../../src/shared/lifecycle-status.ts';
import { knowledge } from '../../src/client/state/knowledge-store.ts';
import {
  activeBoardId,
  boardList,
  boardsLoaded,
  browsingMemory,
  connectBoardCatalog,
  type BoardSummary,
} from '../../src/client/state/boards-store.ts';

const realFetch = globalThis.fetch;
const calls: Array<{ url: string; init?: RequestInit }> = [];
let memoryGraph: MemoryGraph | null = null;
let fixtureEpoch = 0;
let fixtureRevision = 0;

const board = (id: string, name: string, nodeCount: number, folder: string | null = null): BoardSummary => ({
  id,
  name,
  folder,
  createdAt: '2026-09-01T00:00:00.000Z',
  lastOpenedAt: '2026-09-20T00:00:00.000Z',
  nodeCount,
});

beforeAll(() => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/canvas/knowledge') return Response.json(knowledge.value);
    if (url.startsWith('/api/canvas/knowledge/category/') && init?.method === 'DELETE') {
      if (knowledge.value) knowledge.value = { ...knowledge.value, categories: [] };
      return Response.json({ ok: true });
    }
    if (url.startsWith('/api/canvas/memory-graph')) {
      const params = new URL(url, 'http://test').searchParams;
      return Response.json(
        memoryGraph && params.get('projection') === 'boards'
          ? { ...memoryGraph, nodes: memoryGraph.nodes.filter((node) => node.kind === 'board') }
          : memoryGraph,
      );
    }
    const updated =
      init?.method === 'PATCH'
        ? boardList.value.map((entry) =>
            url.endsWith(`/${entry.id}`) ? { ...entry, ...JSON.parse(String(init.body)) } : entry,
          )
        : boardList.value;
    const openedId = url === '/api/canvas/boards/open' ? JSON.parse(String(init?.body)).id : null;
    return new Response(
      JSON.stringify({
        ok: true,
        catalogEpoch: `home-${fixtureEpoch}`,
        catalogRevision: ++fixtureRevision,
        reloadRevision: 0,
        boardGeneration: 0,
        activeBoardId: openedId,
        boards: updated,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls.length = 0;
  fixtureEpoch++;
  fixtureRevision = 0;
  knowledge.value = null;
  connectBoardCatalog(`home-${fixtureEpoch}`);
  boardList.value = [board('b-okr', 'C4 OKR planning', 26), board('b-disc', 'Discovery', 17)];
  memoryGraph = {
    focus: null,
    depth: 2,
    unresolvedLinks: [],
    nodes: [
      ...boardList.value.map((entry) => ({
        key: memoryKey({ boardId: entry.id }),
        boardId: entry.id,
        kind: 'board' as const,
        title: entry.name,
        summary: '',
        folder: null,
        inContext: false,
        summaryOnly: true as const,
      })),
      {
        key: memoryKey({ boardId: 'b-disc', cardId: 'same' }),
        boardId: 'b-disc',
        cardId: 'same',
        kind: 'card',
        title: 'Evidence',
        summary: 'A useful finding',
        folder: null,
        inContext: true,
        summaryOnly: true,
        type: 'markdown',
      },
    ],
    edges: [
      {
        id: 'broken',
        from: memoryKey({ boardId: 'b-disc' }),
        to: memoryKey({ boardId: 'gone' }),
        kind: 'wiki',
        source: { boardId: 'b-disc' },
        target: { boardId: 'gone' },
        missing: true,
      },
    ],
  };
  activeBoardId.value = null;
  boardsLoaded.value = true;
});
afterEach(() => {
  cleanup();
  browsingMemory.value = false;
});

describe('Home memory views', () => {
  test('Map keeps unlinked boards and explicitly exposes broken targets', async () => {
    const { getByRole, getByText, queryByRole } = render(<HomeView />);
    fireEvent.click(getByRole('button', { name: 'Map', exact: true }));
    await waitFor(() => expect(getByRole('button', { name: 'board: Discovery' })).toBeTruthy());
    expect(getByRole('button', { name: 'board: C4 OKR planning' })).toBeTruthy();
    expect(queryByRole('button', { name: 'card: Evidence' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'board: Discovery' }));
    await waitFor(() => expect(getByText('⚠ Missing target: gone')).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Open board' }));
    await waitFor(() => expect(calls.some((call) => call.url === '/api/canvas/boards/open')).toBe(true));
  });

  test('Map uses compact discovery and retains qualified details during a failed live update, then retries', async () => {
    memoryGraph!.edges.push({
      id: 'remote',
      kind: 'card',
      from: memoryKey({ boardId: 'b-okr', cardId: 'same' }),
      to: memoryKey({ boardId: 'b-disc', cardId: 'same' }),
      source: { boardId: 'b-okr', cardId: 'same' },
      target: { boardId: 'b-disc', cardId: 'same' },
      missing: false,
    });
    const { getByRole, queryByText } = render(<HomeView />);
    fireEvent.click(getByRole('button', { name: 'Map', exact: true }));
    await waitFor(() => expect(getByRole('button', { name: 'board: C4 OKR planning' })).toBeTruthy());
    expect(
      new URL(
        calls.find((call) => call.url.startsWith('/api/canvas/memory-graph'))!.url,
        'http://test',
      ).searchParams.get('projection'),
    ).toBe('boards');
    fireEvent.click(getByRole('button', { name: 'board: C4 OKR planning' }));
    await waitFor(() => expect(getByRole('button', { name: 'Evidence', exact: true })).toBeTruthy());
    expect(calls.some((call) => call.url.includes('focus=') && !call.url.includes('projection='))).toBe(true);
    const previousGraph = memoryGraph;
    memoryGraph = null;
    await act(async () => {
      boardList.value = boardList.value.map((entry) =>
        entry.id === 'b-okr'
          ? {
              ...entry,
              name: 'Renamed',
              lastOpenedAt: 'now',
              mapPosition: { x: 777, y: 222 },
              pin: { pinnedBy: { actor: 'human', source: 'browser' }, pinnedAt: 'now' },
            }
          : entry,
      );
    });
    // Observe after Preact's deferred effects, not just the first passing sample.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    const renamed = getByRole('button', { name: 'board: Renamed' });
    expect(renamed.textContent).toContain('In context');
    expect(getByRole('button', { name: 'Evidence', exact: true })).toBeTruthy();
    await waitFor(() => expect(getByRole('button', { name: 'Retry', exact: true })).toBeTruthy());
    memoryGraph = previousGraph;
    fireEvent.click(getByRole('button', { name: 'Retry', exact: true }));
    await waitFor(() => expect(queryByText('Memory update failed.') === null).toBe(true));
  });

  test('Graph requests qualified local focus and pins depth through the human bridge; filters cards', async () => {
    const { getByRole, getByLabelText, queryByRole } = render(<HomeView />);
    fireEvent.click(getByRole('button', { name: 'Graph', exact: true }));
    await waitFor(() => expect(getByRole('button', { name: 'card: Evidence' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'card: Evidence' }));
    fireEvent.click(getByRole('button', { name: 'Focus here' }));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            new URL(call.url, 'http://test').searchParams.get('focus') ===
            memoryKey({ boardId: 'b-disc', cardId: 'same' }),
        ),
      ).toBe(true),
    );
    fireEvent.change(getByLabelText('Focus'), { target: { value: 'pins' } });
    fireEvent.change(getByLabelText('Depth'), { target: { value: '0' } });
    await waitFor(() => expect(calls.some((call) => call.url.includes('depth=0&focus=pins'))).toBe(true));
    const request = calls.find((call) => call.url.includes('depth=0&focus=pins'))!;
    expect(new Headers(request.init?.headers).get('X-PMX-Workbench')).toBe('1');
    fireEvent.click(getByLabelText('Boards'));
    expect(queryByRole('button', { name: 'board: Discovery' })).toBeNull();
    expect(getByRole('button', { name: 'card: Evidence' })).toBeTruthy();
  });

  test('Map saves human drag positions and can return a board to generated layout', async () => {
    const { getByRole } = render(<HomeView />);
    fireEvent.click(getByRole('button', { name: 'Map', exact: true }));
    await waitFor(() => expect(getByRole('button', { name: 'board: Discovery' })).toBeTruthy());
    const node = getByRole('button', { name: 'board: Discovery' });
    const before = node.parentElement!.style;
    const x = parseFloat(before.left),
      y = parseFloat(before.top);
    fireEvent.click(node);
    memoryGraph = null;
    Object.defineProperty(node, 'setPointerCapture', { value: () => {} });
    fireEvent.pointerDown(node, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 1, clientX: 140, clientY: 120 });
    fireEvent.pointerUp(node, { pointerId: 1 });
    await waitFor(() => expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(true));
    const saved = calls.find((call) => call.init?.method === 'PATCH')!;
    expect(JSON.parse(String(saved.init?.body))).toEqual({ mapPosition: { x: x + 40 - 110, y: y + 20 - 46 } });
    expect(new Headers(saved.init?.headers).get('X-PMX-Workbench')).toBe('1');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(getByRole('button', { name: 'board: Discovery' }).parentElement!.style.left).toBe(`${x + 40}px`);
    fireEvent.click(getByRole('button', { name: 'Reset position' }));
    await waitFor(() => expect(calls.filter((call) => call.init?.method === 'PATCH').length).toBe(2));
    expect(JSON.parse(String(calls.filter((call) => call.init?.method === 'PATCH')[1]!.init?.body))).toEqual({
      mapPosition: null,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(getByRole('button', { name: 'board: Discovery' }).parentElement!.style.left).toBe(`${x}px`);
  });
});

describe('Home (docs/design/Home.dc.html)', () => {
  test('a card selects the board into details; Open board opens it as the human', async () => {
    boardList.value = boardList.value.map((entry) =>
      entry.id !== 'b-disc'
        ? entry
        : {
            ...entry,
            summary: '# Agent README **raw Markdown**',
            pinnedTitles: [{ nodeId: 'context', title: 'Agent-only context dump' }],
            links: Array.from({ length: 34 }, (_, index) => ({
              id: `wiki-${index}`,
              nodeId: `note-${index}`,
              boardId: 'b-okr',
              title: 'Repeated target',
              missing: false,
            })),
          },
    );
    const { getByRole, getByTestId, getByText } = render(<HomeView />);
    expect(getByText('C4 OKR planning')).toBeTruthy();
    expect(getByText('17 cards')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Discovery' }));
    const details = getByTestId('home-details');
    expect(details.textContent).toContain('Discovery');
    expect(details.textContent).not.toContain('Agent README');
    expect(details.textContent).not.toContain('Agent-only context dump');
    expect(details.textContent).not.toContain('Repeated target');
    expect(getByRole('switch', { name: "In the agent's context" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Open board' }));
    });
    const open = calls.find((call) => call.url === '/api/canvas/boards/open');
    expect(JSON.parse(String(open?.init?.body))).toEqual({ id: 'b-disc' });
    expect(new Headers(open?.init?.headers).get('X-PMX-Workbench')).toBe('1');
  });

  test('the ⋯ menu focuses its first item, moves with the arrows, and Escape returns to the button', () => {
    const { getByRole } = render(<HomeView />);
    fireEvent.click(getByRole('button', { name: 'Discovery' }));
    const more = getByRole('button', { name: /More: move, rename/ });
    fireEvent.click(more);
    expect(document.activeElement?.textContent).toBe('Move…');
    fireEvent.keyDown(getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('Delete…');
    fireEvent.keyDown(getByRole('menu'), { key: 'Escape' });
    expect(document.activeElement).toBe(more);
  });

  test('delete asks in place from the ⋯ menu, naming the board and what it holds', async () => {
    const { getByRole, getByText, queryByText } = render(<HomeView />);
    const writes = () => calls.filter((call) => call.init?.method);
    fireEvent.click(getByRole('button', { name: 'C4 OKR planning' }));
    fireEvent.click(getByRole('button', { name: /More: move, rename/ }));
    fireEvent.click(getByRole('menuitem', { name: 'Delete…' }));
    expect(getByText(/and its 26 cards and snapshots/)).toBeTruthy();
    expect(writes()).toHaveLength(0);

    fireEvent.click(getByText('Cancel'));
    expect(queryByText(/and its 26 cards/)).toBeNull();

    fireEvent.click(getByRole('button', { name: /More: move, rename/ }));
    fireEvent.click(getByRole('menuitem', { name: 'Delete…' }));
    await act(async () => {
      fireEvent.click(getByText('Delete board'));
    });
    expect(writes().map((call) => [call.init?.method, call.url])).toEqual([['DELETE', '/api/canvas/boards/b-okr']]);
  });

  test('the in-context switch pins the board; pinned boards are listed with their cost', async () => {
    boardList.value = [
      {
        ...board('b-okr', 'C4 OKR planning', 26),
        pin: { pinnedBy: { actor: 'human', source: 'browser' }, pinnedAt: 'x' },
        mapChars: 4000,
      },
      board('b-disc', 'Discovery', 17),
    ];
    const { getByRole, getByLabelText } = render(<HomeView />);
    expect(getByLabelText('Pinned boards').textContent).toContain('C4 OKR planning');
    expect(getByRole('complementary', { name: 'Library' }).textContent).toContain('≈ 1.0k tokens · 1 board');
    fireEvent.click(getByRole('button', { name: 'Discovery' }));
    await act(async () => {
      fireEvent.click(getByRole('switch', { name: "In the agent's context" }));
    });
    expect(calls.some((call) => call.url === '/api/canvas/boards/b-disc/pin')).toBe(true);
  });
});

describe('Home folders', () => {
  test('the tree lists folders, migrated snapshots start folded, a folder shows its boards, and a board can be moved', async () => {
    localStorage.removeItem('pmx-canvas-home-collapsed');
    boardList.value = [
      board('b-okr', 'C4 OKR planning', 26, 'Planning/Quarterly'),
      { ...board('b-loose', 'Scratch', 2), lastOpenedAt: '2026-09-21T00:00:00.000Z' },
      board('b-old', 'Before session · Copilot · 14:00', 9, 'From old snapshots/Copilot'),
    ];
    const due: LifecycleQualification = {
      retired: false,
      unknown: false,
      due: true,
      reasons: ['Review cadence elapsed'],
      changedSinceRead: false,
      lastReadAt: null,
      lastValidatedAt: null,
      contentRevision: 1,
      contentChangedAt: null,
      observations: {},
      sources: [],
      relevance: 'not-selected',
    };
    knowledge.value = {
      ok: true,
      categories: [],
      folders: [],
      relationPresets: [],
      resolvedFolders: {},
      cards: {
        [memoryKey({ boardId: 'b-okr', cardId: 'due' })]: due,
        [memoryKey({ boardId: 'b-okr', cardId: 'unclassified' })]: { ...due, due: false, unknown: true },
        [memoryKey({ boardId: 'b-okr', cardId: 'retired' })]: { ...due, retired: true },
        [memoryKey({ boardId: 'b-loose', cardId: 'other' })]: due,
      },
    };
    const { getByLabelText, getByRole, queryByText } = render(<HomeView />);
    const tree = getByLabelText('Folders');
    const rows = () => [...tree.querySelectorAll('.home-tree-name')].map((row) => row.textContent);
    // The migrated shelf is folded until opened; Planning is open.
    expect(rows()).toEqual(['From old snapshots', 'Planning', 'Quarterly', 'Unfiled']);
    fireEvent.click(getByRole('button', { name: 'Unfold From old snapshots' }));
    expect(rows()).toEqual(['From old snapshots', 'Copilot', 'Planning', 'Quarterly', 'Unfiled']);
    expect(queryByText('Back up now')).toBeNull();
    expect(tree.textContent).not.toContain('due');
    expect(tree.textContent).not.toContain('unknown');
    expect(getByRole('region', { name: 'Folder review summary' }).textContent).toContain('Across the library');
    expect(getByRole('region', { name: 'Folder review summary' }).textContent).toContain('Review needed: 2 cards');

    // Unfiled is the starting folder here (the most recently opened board is unfiled).
    expect(getByRole('list', { name: 'Unfiled boards' }).textContent).toContain('Scratch');
    fireEvent.click(getByRole('button', { name: 'Planning' }));
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Planning');
    expect(document.querySelector('[data-testid="home-section"][data-folder="Planning/Quarterly"]')).toBeTruthy();
    expect(getByRole('region', { name: 'Folder review summary' }).textContent).toContain(
      'In this folder and subfolders',
    );
    expect(getByRole('region', { name: 'Folder review summary' }).textContent).toContain('Review needed: 1 card');
    expect(getByRole('region', { name: 'Folder review summary' }).textContent).toContain('No review policy: 1 card');
    fireEvent.click(getByRole('button', { name: 'Review needed: 1 card' }));
    const toReview = getByRole('list', { name: 'Boards needing review' });
    expect(toReview.textContent).toContain('C4 OKR planning');
    expect(toReview.textContent).not.toContain('Scratch');
    expect(getByRole('button', { name: 'Review C4 OKR planning' })).toBeTruthy();

    // Move Scratch into a new child under an implicit parent folder.
    fireEvent.click(getByRole('button', { name: 'Unfiled' }));
    fireEvent.click(getByRole('button', { name: 'Scratch' }));
    fireEvent.click(getByRole('button', { name: /More: move, rename/ }));
    fireEvent.click(getByRole('menuitem', { name: 'Move…' }));
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
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ folder: 'Planning/Monthly' });
    expect(new Headers(patch?.init?.headers).get('X-PMX-Workbench')).toBe('1');
    await waitFor(() => expect(rows()).toContain('Monthly'));
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

  test.each([false, true])('category deletion is in-app and refuses assigned empty folders (used=%s)', async (used) => {
    const category = {
      id: 'unused',
      name: 'Unused',
      glyph: 'U',
      decayType: 'reality' as const,
      rate: 'durable' as const,
      triggers: [],
      revalidationMethod: 'check',
    };
    knowledge.value = {
      ok: true,
      categories: [category],
      folders: used ? [{ path: 'Empty', categoryId: category.id, lifecycleOverride: null }] : [],
      relationPresets: [],
      cards: {},
      resolvedFolders: {},
    };
    const { getByRole, queryByRole, getByText } = render(<KnowledgeDialog onClose={() => {}} />);
    fireEvent.click(getByRole('button', { name: /U Unused/ }));
    if (used) {
      expect(getByText(/Cannot delete: assigned to Empty/)).toBeTruthy();
      expect(queryByRole('button', { name: 'Delete category' })).toBeNull();
      return;
    }
    fireEvent.click(getByRole('button', { name: 'Delete category' }));
    expect(getByRole('group', { name: 'Confirm category deletion' })).toBeTruthy();
    expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false);
    fireEvent.click(getByRole('button', { name: 'Cancel deletion' }));
    expect(queryByRole('group', { name: 'Confirm category deletion' })).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Delete category' }));
    fireEvent.click(getByRole('button', { name: 'Confirm deletion' }));
    await waitFor(() => expect(getByText('Category deleted.')).toBeTruthy());
    const deletion = calls.find((call) => call.init?.method === 'DELETE');
    expect(deletion?.url).toBe('/api/canvas/knowledge/category/unused');
    expect(new Headers(deletion?.init?.headers).get('X-PMX-Workbench')).toBe('1');
    expect(queryByRole('button', { name: 'Save category' })).toBeNull();
  });

  test('shows the workspace name until the board list arrives', () => {
    boardsLoaded.value = false;
    const { getByRole } = render(<BoardSwitcher fallbackName="repo" />);
    expect(getByRole('button', { name: /Board: repo/ })).toBeTruthy();
  });
});
