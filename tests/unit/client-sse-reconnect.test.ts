import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectSSE, EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import {
  activeNodeId,
  connectionStatus,
  contextPinnedNodeIds,
  edges,
  hasInitialServerLayout,
  nodes,
  selectedNodeIds,
  viewport,
} from '../../src/client/state/canvas-store.ts';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const originalLocalStorage = globalThis.localStorage;
const originalEventSource = globalThis.EventSource;

class FakeEventSource {
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(): void {}

  close(): void {
    this.closed = true;
  }
}

function resetClientState(): void {
  viewport.value = { x: 0, y: 0, scale: 1 };
  nodes.value = new Map();
  edges.value = new Map();
  activeNodeId.value = null;
  selectedNodeIds.value = new Set();
  contextPinnedNodeIds.value = new Set();
  hasInitialServerLayout.value = false;
  connectionStatus.value = 'connecting';
}

function threadTurns(nodeId: string): Array<Record<string, unknown>> {
  const node = nodes.value.get(nodeId);
  if (!node) throw new Error(`node ${nodeId} missing`);
  const turns = node.data.turns;
  if (!Array.isArray(turns)) throw new Error(`node ${nodeId} has no turns array`);
  return turns as Array<Record<string, unknown>>;
}

describe('sse-bridge reconnect', () => {
  beforeEach(() => {
    resetClientState();

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerWidth: 1200, innerHeight: 800 },
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
      },
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(performance.now() + 400);
        return 1;
      },
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: () => undefined,
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        )) as unknown as typeof fetch,
    });
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: FakeEventSource as unknown as typeof EventSource,
    });
  });

  afterEach(() => {
    resetClientState();
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: originalRequestAnimationFrame,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: originalCancelAnimationFrame,
    });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage });
    Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: originalEventSource });
  });

  test('connectSSE clears stale response→thread routes from the previous connection', () => {
    // A thread prompt node with an in-flight streaming response.
    EVENT_HANDLERS['canvas-prompt-created']({ nodeId: 'prompt-1', text: 'hello' });
    EVENT_HANDLERS['canvas-response-start']({ responseNodeId: 'resp-1', promptNodeId: 'prompt-1' });
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'resp-1', content: 'partial' });

    // Sanity: the delta routed into the thread's turns.
    expect(threadTurns('prompt-1')).toHaveLength(2);
    expect(threadTurns('prompt-1')[1]).toMatchObject({ role: 'assistant', text: 'partial' });

    // The connection drops mid-stream; connectSSE is the shared re-entry path
    // for both transports and must reset the per-connection routing map.
    const disconnect = connectSSE();
    disconnect();

    // A stale delta for the dead stream must NOT reach the thread anymore.
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'resp-1', content: 'stale delta' });
    expect(threadTurns('prompt-1')[1]).toMatchObject({ text: 'partial' });

    // Fresh streams established after the reconnect still route normally.
    EVENT_HANDLERS['canvas-response-start']({ responseNodeId: 'resp-2', promptNodeId: 'prompt-1' });
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'resp-2', content: 'fresh' });
    expect(threadTurns('prompt-1')).toHaveLength(3);
    expect(threadTurns('prompt-1')[2]).toMatchObject({ role: 'assistant', text: 'fresh', status: 'streaming' });

    EVENT_HANDLERS['canvas-response-complete']({ responseNodeId: 'resp-2', content: 'final' });
    expect(threadTurns('prompt-1')[2]).toMatchObject({ text: 'final', status: 'complete' });
    const promptNode = nodes.value.get('prompt-1');
    expect(promptNode?.data.threadStatus).toBe('answered');
  });
});
