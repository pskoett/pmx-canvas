import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { effect } from '@preact/signals';
import {
  activeBoardId,
  applyBoards,
  boardList,
  boardsLoaded,
  connectBoardCatalog,
  createAndOpenBoard,
  lifecycleTarget,
  openBoard,
  openMemoryTarget,
  updateBoard,
} from '../../src/client/state/boards-store.ts';
import {
  activeNodeId,
  addContextPins,
  axSurfaceState,
  clearContextPins,
  contextPinnedNodeIds,
  edges,
  expandedNodeId,
  hasInitialServerLayout,
  nodes,
  pendingConnection,
  selectedEdgeId,
  selectedNodeIds,
  viewport,
} from '../../src/client/state/canvas-store.ts';
import { EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import { resetAttentionBridge } from '../../src/client/state/attention-bridge.ts';
import { attentionHistory } from '../../src/client/state/attention-store.ts';
import { applySessionReceipt, dismissSessionReceipt, sessionReceipt } from '../../src/client/state/session-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

const originalFetch = globalThis.fetch;
let fixtureEpoch = 0;
let fixtureRevision = 0;

interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

function boardPayload(active: string) {
  return {
    catalogEpoch: `test-${fixtureEpoch}`,
    catalogRevision: ++fixtureRevision,
    reloadRevision: 0,
    activeBoardId: active,
    boards: [{ id: active, name: active, folder: null, createdAt: '', lastOpenedAt: null, nodeCount: 1 }],
  };
}

function layout(id: string): {
  nodes: CanvasNodeState[];
  edges: [];
  viewport: { x: number; y: number; scale: number };
} {
  return {
    nodes: [
      {
        id,
        type: 'markdown',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 180 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        data: {},
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };
}

beforeEach(() => {
  boardsLoaded.value = false;
  fixtureEpoch++;
  fixtureRevision = 0;
  connectBoardCatalog(`test-${fixtureEpoch}`);
  boardList.value = [];
  activeBoardId.value = null;
  hasInitialServerLayout.value = false;
  nodes.value = new Map();
  edges.value = new Map();
  activeNodeId.value = null;
  expandedNodeId.value = null;
  selectedNodeIds.value = new Set();
  selectedEdgeId.value = null;
  pendingConnection.value = null;
  contextPinnedNodeIds.value = new Set();
  applyBoards(boardPayload('A'));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  dismissSessionReceipt();
});

describe('board switch client state', () => {
  test.each(['B', null])('replacement state reads carry their captured board owner (%s)', (boardId) => {
    const urls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    applyBoards({ ...boardPayload('B'), activeBoardId: boardId });
    const stateUrl = urls.find((url) => url.includes('/api/canvas/state'));
    expect(new URL(stateUrl!, 'http://localhost').searchParams.get('expectedBoardId')).toBe(boardId ?? 'null');
  });

  test.each([true, false])('initial layout before the board catalog survives (tagged=%s)', (tagged) => {
    boardsLoaded.value = false;
    activeBoardId.value = null;
    EVENT_HANDLERS['canvas-layout-update']({ ...(tagged ? { boardId: 'A' } : {}), layout: layout('initial') });
    applyBoards(boardPayload('A'));
    expect([...nodes.value.keys()]).toEqual(['initial']);
    expect(hasInitialServerLayout.value).toBe(true);
  });

  test('a tagged replacement layout never renders under the previous board identity', () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'A', layout: layout('A-card') });
    const seen: string[] = [];
    const stop = effect(() => {
      seen.push(`${activeBoardId.value}:${[...nodes.value.keys()].join(',')}`);
    });
    try {
      EVENT_HANDLERS['canvas-layout-update']({ boardId: 'B', layout: layout('B-card') });
      expect([...nodes.value.keys()]).toEqual(['A-card']);
      applyBoards(boardPayload('B'));
      expect([...nodes.value.keys()]).toEqual(['B-card']);
      expect(seen).toEqual(['A:A-card', 'B:B-card']);
    } finally {
      stop();
    }
  });

  test('navigation resets attention but preserves changes to reopen; Home dismisses the receipt', async () => {
    globalThis.fetch = Object.assign(() => Promise.resolve(json({})), { preconnect: originalFetch.preconnect });
    resetAttentionBridge();
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'A', layout: layout('A-node') });
    applySessionReceipt({
      label: 'A session',
      endedAt: new Date().toISOString(),
      snapshot: { id: 'A-snapshot', name: 'A' },
    });
    expect(sessionReceipt.value).not.toBeNull();
    // The server broadcasts layout before boards-changed on navigation.
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'B', layout: layout('B-node') });
    expect(attentionHistory.value.some((entry) => entry.title === 'Items removed')).toBe(false);
    EVENT_HANDLERS['boards-changed'](boardPayload('B'));
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'B', layout: layout('B-node') });
    await Bun.sleep(0);
    expect(sessionReceipt.value?.snapshot?.id).toBe('A-snapshot');
    expect(attentionHistory.value.some((entry) => entry.title === 'Items removed')).toBe(false);
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'B', layout: { ...layout('B-node'), nodes: [] } });
    expect(attentionHistory.value.some((entry) => entry.title === 'Items removed')).toBe(true);
    EVENT_HANDLERS['boards-changed']({ ...boardPayload('B'), activeBoardId: null });
    expect(sessionReceipt.value).toBeNull();
    resetAttentionBridge();
  });

  test('A -> B -> C ignores late B layout, pins, and approvals', async () => {
    const requests: DeferredResponse[] = [];
    globalThis.fetch = (() => {
      const request = deferredResponse();
      requests.push(request);
      return request.promise;
    }) as unknown as typeof fetch;

    EVENT_HANDLERS['boards-changed'](boardPayload('B'));
    EVENT_HANDLERS['boards-changed'](boardPayload('C'));
    expect(requests).toHaveLength(6);

    requests[3]!.resolve(json({ approvalGates: [{ id: 'C-gate' }] }));
    requests[4]!.resolve(json(layout('C-node')));
    requests[5]!.resolve(json({ nodeIds: ['C-node'] }));
    await Promise.all(requests.slice(3).map((request) => request.promise));
    await Bun.sleep(0);
    expect([...nodes.value.keys()]).toEqual(['C-node']);
    expect([...contextPinnedNodeIds.value]).toEqual(['C-node']);

    requests[0]!.resolve(json({ approvalGates: [{ id: 'B-gate' }] }));
    requests[1]!.resolve(json(layout('B-node')));
    requests[2]!.resolve(json({ nodeIds: ['B-node'] }));
    await Promise.all(requests.slice(0, 3).map((request) => request.promise));
    await Bun.sleep(0);
    expect([...nodes.value.keys()]).toEqual(['C-node']);
    expect([...contextPinnedNodeIds.value]).toEqual(['C-node']);
    expect(axSurfaceState.value).toEqual({ approvalGates: [{ id: 'C-gate' }] });
  });

  test.each(['layout', 'pins', 'both'])('newer %s SSE survives an older same-board HTTP response', async (surface) => {
    const requests: DeferredResponse[] = [];
    globalThis.fetch = (() => {
      const request = deferredResponse();
      requests.push(request);
      return request.promise;
    }) as unknown as typeof fetch;
    EVENT_HANDLERS['boards-changed'](boardPayload('B'));
    if (surface !== 'pins') EVENT_HANDLERS['canvas-layout-update']({ layout: layout('new-B') });
    if (surface !== 'layout')
      EVENT_HANDLERS['context-pins-changed']({ nodeIds: [surface === 'pins' ? 'old-B' : 'new-B'] });
    requests[0]!.resolve(json({ approvalGates: [] }));
    requests[1]!.resolve(json(layout('old-B')));
    requests[2]!.resolve(json({ nodeIds: surface === 'pins' ? [] : ['old-B'] }));
    await Bun.sleep(0);
    expect([...nodes.value.keys()]).toEqual([surface === 'pins' ? 'old-B' : 'new-B']);
    expect([...contextPinnedNodeIds.value]).toEqual([surface === 'both' ? 'new-B' : 'old-B']);
  });

  test('pending pins from the previous board do not block canonical pins or later clears', async () => {
    const writes: DeferredResponse[] = [];
    let canonical: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/canvas/context-pins' && init?.method === 'POST') {
        const write = deferredResponse();
        writes.push(write);
        return write.promise;
      }
      if (String(input) === '/api/workbench/poll')
        return json({ events: [{ event: 'context-pins-changed', payload: { nodeIds: canonical, boardId: 'B' } }] });
      return json(String(input) === '/api/canvas/pinned-context' ? { nodeIds: canonical } : {});
    }) as unknown as typeof fetch;
    addContextPins(['A-card']);
    applyBoards(boardPayload('B'));
    await Bun.sleep(0);
    const requested = Array.from({ length: 21 }, (_, index) => `B-${index}`);
    addContextPins(requested);
    canonical = requested.slice(0, 20);
    writes[1]!.resolve(json({ ok: true, count: 20 }));
    await Bun.sleep(0);
    expect([...contextPinnedNodeIds.value]).toEqual(canonical);
    clearContextPins();
    // The old board's acknowledgement must not release the new board's pending write.
    writes[0]!.resolve(json({ ok: true, count: 1 }));
    await Bun.sleep(0);
    EVENT_HANDLERS['context-pins-changed']({ nodeIds: ['B-stale'] });
    expect([...contextPinnedNodeIds.value]).toEqual([]);
    canonical = [];
    writes[2]!.resolve(json({ ok: true, count: 0 }));
    await Bun.sleep(0);
    EVENT_HANDLERS['context-pins-changed']({ nodeIds: ['B-agent'] });
    expect([...contextPinnedNodeIds.value]).toEqual(['B-agent']);
  });

  test('shared ids do not preserve interaction state across boards', () => {
    const shared = layout('shared').nodes[0]!;
    nodes.value = new Map([['shared', shared]]);
    activeNodeId.value = 'shared';
    expandedNodeId.value = 'shared';
    selectedNodeIds.value = new Set(['shared']);
    selectedEdgeId.value = 'shared-edge';
    pendingConnection.value = { from: 'shared' };
    contextPinnedNodeIds.value = new Set(['shared']);
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    EVENT_HANDLERS['boards-changed'](boardPayload('B'));

    expect([...nodes.value.keys()]).toEqual([]);
    expect([...edges.value.keys()]).toEqual([]);
    expect(activeNodeId.value).toBeNull();
    expect(expandedNodeId.value).toBeNull();
    expect([...selectedNodeIds.value]).toEqual([]);
    expect(selectedEdgeId.value).toBeNull();
    expect(pendingConnection.value).toBeNull();
    expect([...contextPinnedNodeIds.value]).toEqual([]);
  });

  test.each([
    'open',
    'rename',
  ] as const)('a late %s response cannot overwrite a newer boards SSE frame', async (action) => {
    const openResponse = deferredResponse();
    const older = boardPayload('B');
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/canvas/boards/')) return openResponse.promise;
      return Promise.resolve(json(url.includes('pinned-context') ? { nodeIds: [] } : layout('C-node')));
    }) as typeof fetch;

    const opening = action === 'open' ? openBoard('B') : updateBoard('A', { name: 'Renamed' });
    EVENT_HANDLERS['boards-changed'](boardPayload('C'));
    openResponse.resolve(json(older));
    await opening;

    expect(activeBoardId.value).toBe('C');
  });

  test('a delayed create does not open after an explicit open intent', async () => {
    const createResponse = deferredResponse();
    const opened: Array<string | null> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === '/api/canvas/boards') return createResponse.promise;
      if (url === '/api/canvas/boards/open') {
        const id = JSON.parse(String(init?.body)).id as string | null;
        opened.push(id);
        return json(boardPayload(id ?? 'A'));
      }
      return json(url.includes('pinned-context') ? { nodeIds: [] } : layout('B-node'));
    }) as typeof fetch;

    const creating = createAndOpenBoard('Created');
    await openBoard('B');
    createResponse.resolve(json({ board: boardPayload('C').boards[0] }));
    await creating;

    expect(opened).toEqual(['B']);
    expect(activeBoardId.value).toBe('B');
  });

  test('review navigation cannot target a reused card ID after a later board choice', async () => {
    globalThis.fetch = ((input, init) => {
      if (String(input) === '/api/canvas/boards/open') {
        return Promise.resolve(json(boardPayload(JSON.parse(String(init?.body)).id)));
      }
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    const staleReview = openMemoryTarget({ boardId: 'B', cardId: 'shared' }, { review: true });
    await Bun.sleep(0);
    await openBoard('A');
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'A', layout: layout('shared') });
    expect(await staleReview).toBe(false);
    expect(activeBoardId.value).toBe('A');
    expect(lifecycleTarget.value).toBeNull();

    const currentReview = openMemoryTarget({ boardId: 'B', cardId: 'shared' }, { review: true });
    await Bun.sleep(0);
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'B', layout: layout('shared') });
    expect(await currentReview).toBe(true);
    expect(lifecycleTarget.value).toMatchObject({ boardId: 'B', nodeId: 'shared' });
    await openBoard('A');
    expect(lifecycleTarget.value).toBeNull();
  });

  test('two delayed opens reach the server and settle in click order', async () => {
    const firstResponse = deferredResponse();
    const secondResponse = deferredResponse();
    const started: string[] = [];
    globalThis.fetch = ((input, init) => {
      if (String(input) !== '/api/canvas/boards/open') return Promise.resolve(json({}));
      const id = JSON.parse(String(init?.body)).id as string;
      started.push(id);
      return id === 'B' ? firstResponse.promise : secondResponse.promise;
    }) as typeof fetch;

    const first = openBoard('B');
    const second = openBoard('C');
    await Bun.sleep(0);
    expect(started).toEqual(['B']);

    firstResponse.resolve(json(boardPayload('B')));
    await Bun.sleep(0);
    expect(started).toEqual(['B', 'C']);
    secondResponse.resolve(json(boardPayload('C')));
    await Promise.all([first, second]);

    expect(activeBoardId.value).toBe('C');
  });

  test('a create opens its board after the normal boards SSE update', async () => {
    const createResponse = deferredResponse();
    const opened: Array<string | null> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === '/api/canvas/boards') return createResponse.promise;
      if (url === '/api/canvas/boards/open') {
        const id = JSON.parse(String(init?.body)).id as string | null;
        opened.push(id);
        return json(boardPayload(id ?? 'A'));
      }
      return json(url.includes('pinned-context') ? { nodeIds: [] } : layout('C-node'));
    }) as typeof fetch;

    const creating = createAndOpenBoard('Created');
    const created = boardPayload('C').boards[0]!;
    EVENT_HANDLERS['boards-changed']({
      ...boardPayload('A'),
      boards: [...boardPayload('A').boards, created],
    });
    createResponse.resolve(json({ board: created }));
    await creating;

    expect(opened).toEqual(['C']);
    expect(activeBoardId.value).toBe('C');
  });

  test('older streamed catalogs cannot undo a newer HTTP selection; genuine newer switches still apply', () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const older = boardPayload('A');
    const selected = boardPayload('B');
    applyBoards(selected);
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'B', layout: layout('B-card') });
    EVENT_HANDLERS['boards-changed'](older);
    EVENT_HANDLERS['boards-changed'](selected);
    expect(activeBoardId.value).toBe('B');
    expect([...nodes.value.keys()]).toEqual(['B-card']);
    EVENT_HANDLERS['boards-changed'](boardPayload('C'));
    expect(activeBoardId.value).toBe('C');
    expect([...nodes.value.keys()]).toEqual([]);
  });

  test('an obsolete activation cannot become a later visit to the same board camera baseline', () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    applyBoards({ ...boardPayload('B'), boardGeneration: 4 });
    const old = { ...layout('A-card'), viewport: { x: 300, y: 200, scale: 0.5 } };
    EVENT_HANDLERS['canvas-layout-update']({
      catalogEpoch: `test-${fixtureEpoch}`,
      boardGeneration: 3,
      boardId: 'A',
      layout: old,
    });
    applyBoards({ ...boardPayload('A'), boardGeneration: 5 });
    const fresh = { ...layout('A-card'), viewport: { x: 90, y: 60, scale: 0.8 } };
    EVENT_HANDLERS['canvas-layout-update']({
      catalogEpoch: `test-${fixtureEpoch}`,
      boardGeneration: 5,
      boardId: 'A',
      layout: fresh,
    });
    expect(viewport.value).toEqual(fresh.viewport);
  });

  test('a reload survives an overtaking GET, without replaying the reset for its older event', () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'A', layout: layout('before-restore') });
    const restored = boardPayload('A');
    restored.reloadRevision = restored.catalogRevision;
    applyBoards({ ...boardPayload('A'), reloadRevision: restored.reloadRevision });
    expect([...nodes.value.keys()]).toEqual([]);
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'A', layout: layout('restored') });
    EVENT_HANDLERS['boards-changed'](restored);
    expect([...nodes.value.keys()]).toEqual(['restored']);
  });

  test.each([
    true,
    false,
  ])('same-board restart drains tagged snapshots without closing the editor (layout first=%s)', (layoutFirst) => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const older = boardPayload('A');
    const current = boardPayload('B');
    applyBoards(current);
    connectBoardCatalog(current.catalogEpoch);
    applyBoards(older);
    expect(activeBoardId.value).toBe('B');
    const oldLayout = layout('shared');
    oldLayout.nodes[0]!.contentRevision = 99;
    oldLayout.nodes[0]!.data.content = 'Old run';
    EVENT_HANDLERS['canvas-layout-update']({ boardId: 'B', layout: oldLayout });
    expandedNodeId.value = 'shared';
    selectedNodeIds.value = new Set(['shared']);
    const fresh = { ...current, catalogEpoch: 'replacement-server', catalogRevision: 1, boardGeneration: 1 };
    applyBoards(fresh);
    expect(nodes.value.get('shared')?.data.content).toBe('Old run');
    EVENT_HANDLERS.connected({ catalogEpoch: fresh.catalogEpoch });
    const freshLayout = layout('shared');
    freshLayout.nodes[0]!.contentRevision = 7;
    freshLayout.nodes[0]!.data.content = 'Fresh run';
    freshLayout.viewport = { x: 130, y: 75, scale: 0.6 };
    const frame = { catalogEpoch: fresh.catalogEpoch, boardGeneration: 1, boardId: 'B', layout: freshLayout };
    if (layoutFirst) EVENT_HANDLERS['canvas-layout-update'](frame);
    applyBoards(fresh);
    if (!layoutFirst) EVENT_HANDLERS['canvas-layout-update'](frame);
    expect(nodes.value.get('shared')?.data.content).toBe('Fresh run');
    expect(nodes.value.get('shared')?.contentRevision).toBe(7);
    expect(viewport.value).toEqual(freshLayout.viewport);
    expect(hasInitialServerLayout.value).toBe(true);
    expect(expandedNodeId.value).toBe('shared');
    expect([...selectedNodeIds.value]).toEqual(['shared']);
    applyBoards({ ...current, catalogRevision: 1000 });
    expect(nodes.value.get('shared')?.data.content).toBe('Fresh run');
    expect(activeBoardId.value).toBe('B');
  });
});
