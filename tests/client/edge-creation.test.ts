import { afterEach, beforeEach, expect, test } from 'bun:test';
import { resetAttentionBridge } from '../../src/client/state/attention-bridge.ts';
import { attentionToast } from '../../src/client/state/attention-store.ts';
import { addEdge, edges, nodes, resetCanvasInteractionState } from '../../src/client/state/canvas-store.ts';
import { createEdgeFromClient } from '../../src/client/state/intent-bridge.ts';
import type { CanvasEdge, CanvasNodeState } from '../../src/client/types.ts';

const realFetch = globalThis.fetch;
const saved: CanvasEdge = { id: 'server-edge', from: 'a', to: 'b', type: 'relation', label: 'review' };
let respond: (response: Response) => void;
let request: RequestInit | undefined;

beforeEach(() => {
  resetCanvasInteractionState();
  resetAttentionBridge();
  edges.value = new Map();
  nodes.value = new Map(
    ['a', 'b'].map((id): [string, CanvasNodeState] => [
      id,
      {
        id,
        type: 'markdown',
        position: { x: 0, y: 0 },
        size: { width: 360, height: 180 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        data: {},
      },
    ]),
  );
  globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
    request = init;
    return new Promise<Response>((resolve) => {
      respond = resolve;
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetAttentionBridge();
  nodes.value = new Map();
  edges.value = new Map();
});

test('renders only the confirmed HTTP edge, without a background event; replay does not duplicate it', async () => {
  const pending = createEdgeFromClient('a', 'b', 'relation', 'review');
  expect(edges.value.size).toBe(0);
  expect(new Headers(request?.headers).get('X-PMX-Workbench')).toBe('1');
  expect(JSON.parse(String(request?.body))).toEqual({ from: 'a', to: 'b', type: 'relation', label: 'review' });
  respond(Response.json({ ok: true, ...saved }));
  await pending;
  expect([...edges.value.values()]).toEqual([saved]);
  addEdge(saved);
  expect([...edges.value.values()]).toEqual([saved]);
});

test('a refused connection is not drawn and retains the server reason', async () => {
  const pending = createEdgeFromClient('a', 'b', 'relation');
  respond(Response.json({ ok: false, error: 'Target is locked.' }, { status: 409 }));
  await pending;
  expect(edges.value.size).toBe(0);
  expect(attentionToast.value?.detail).toBe('Target is locked.');
});

test('a late response cannot resurrect an edge after navigation, even with identical node IDs', async () => {
  const pending = createEdgeFromClient('a', 'b', 'relation');
  resetCanvasInteractionState();
  respond(Response.json({ ok: true, ...saved }));
  await pending;
  expect(edges.value.size).toBe(0);
});

test('a late response cannot connect a removed endpoint', async () => {
  const pending = createEdgeFromClient('a', 'b', 'relation');
  nodes.value = new Map([['a', nodes.value.get('a')!]]);
  respond(Response.json({ ok: true, ...saved }));
  await pending;
  expect(edges.value.size).toBe(0);
});
