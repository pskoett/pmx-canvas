import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  activeBoardId,
  applyBoards,
  boardList,
  boardsLoaded,
  createAndOpenBoard,
  openBoard,
  updateBoard,
} from '../../src/client/state/boards-store.ts';
import {
  activeNodeId,
  axSurfaceState,
  contextPinnedNodeIds,
  edges,
  expandedNodeId,
  nodes,
  pendingConnection,
  selectedEdgeId,
  selectedNodeIds,
} from '../../src/client/state/canvas-store.ts';
import { EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import { resetAttentionBridge } from '../../src/client/state/attention-bridge.ts';
import { attentionHistory } from '../../src/client/state/attention-store.ts';
import { applySessionReceipt, dismissSessionReceipt, sessionReceipt } from '../../src/client/state/session-store.ts';
import type { CanvasNodeState } from '../../src/client/types.ts';

const originalFetch = globalThis.fetch;

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
    activeBoardId: active,
    boards: [{ id: active, name: active, category: null, createdAt: '', lastOpenedAt: null, nodeCount: 1 }],
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
  boardList.value = [];
  activeBoardId.value = null;
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
  test('navigation resets attention but preserves changes to reopen; Home dismisses the receipt', async () => {
    globalThis.fetch = Object.assign(() => Promise.resolve(json({})), { preconnect: originalFetch.preconnect });
    resetAttentionBridge();
    EVENT_HANDLERS['canvas-layout-update']({ layout: layout('A-node') });
    applySessionReceipt({
      label: 'A session',
      endedAt: new Date().toISOString(),
      snapshot: { id: 'A-snapshot', name: 'A' },
    });
    expect(sessionReceipt.value).not.toBeNull();
    EVENT_HANDLERS['boards-changed'](boardPayload('B'));
    EVENT_HANDLERS['canvas-layout-update']({ layout: layout('B-node') });
    await Bun.sleep(0);
    expect(sessionReceipt.value?.snapshot?.id).toBe('A-snapshot');
    expect(attentionHistory.value.some((entry) => entry.title === 'Items removed')).toBe(false);
    EVENT_HANDLERS['canvas-layout-update']({ layout: { ...layout('B-node'), nodes: [] } });
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
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/canvas/boards/')) return openResponse.promise;
      return Promise.resolve(json(url.includes('pinned-context') ? { nodeIds: [] } : layout('C-node')));
    }) as typeof fetch;

    const opening = action === 'open' ? openBoard('B') : updateBoard('A', { name: 'Renamed' });
    EVENT_HANDLERS['boards-changed'](boardPayload('C'));
    openResponse.resolve(json(boardPayload('B')));
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
      activeBoardId: 'A',
      boards: [...boardPayload('A').boards, created],
    });
    createResponse.resolve(json({ board: created }));
    await creating;

    expect(opened).toEqual(['C']);
    expect(activeBoardId.value).toBe('C');
  });
});
