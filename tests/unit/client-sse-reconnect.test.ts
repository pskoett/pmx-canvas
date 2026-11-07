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

  test('a stream keeps routing across a reconnect while the server still shows it active', () => {
    // A thread prompt node with an in-flight streaming response.
    EVENT_HANDLERS['canvas-prompt-created']({ nodeId: 'prompt-1', text: 'hello' });
    EVENT_HANDLERS['canvas-response-start']({ responseNodeId: 'resp-1', promptNodeId: 'prompt-1' });
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'resp-1', content: 'partial' });

    // Sanity: the delta routed into the thread's turns.
    expect(threadTurns('prompt-1')).toHaveLength(2);
    expect(threadTurns('prompt-1')[1]).toMatchObject({ role: 'assistant', text: 'partial' });

    // The connection drops mid-stream and comes back to the same server, whose
    // snapshot still carries the thread's `_activeResponseId`: the stream goes on.
    const disconnect = connectSSE();
    disconnect();
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'resp-1', content: 'partial and more' });
    expect(threadTurns('prompt-1')[1]).toMatchObject({ text: 'partial and more', status: 'streaming' });
    EVENT_HANDLERS['canvas-response-complete']({ responseNodeId: 'resp-1', content: 'whole answer' });
    expect(threadTurns('prompt-1')[1]).toMatchObject({ text: 'whole answer', status: 'complete' });
    expect(nodes.value.get('prompt-1')?.data.threadStatus).toBe('answered');

    // A finished stream no longer routes.
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'resp-1', content: 'stale delta' });
    expect(threadTurns('prompt-1')[1]).toMatchObject({ text: 'whole answer' });

    // Fresh streams established after the reconnect still route normally.
    EVENT_HANDLERS['canvas-response-start']({ responseNodeId: 'resp-2', promptNodeId: 'prompt-1' });
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'resp-2', content: 'fresh' });
    expect(threadTurns('prompt-1')).toHaveLength(3);
    expect(threadTurns('prompt-1')[2]).toMatchObject({ role: 'assistant', text: 'fresh', status: 'streaming' });

    EVENT_HANDLERS['canvas-response-complete']({ responseNodeId: 'resp-2', content: 'final' });
    expect(threadTurns('prompt-1')[2]).toMatchObject({ text: 'final', status: 'complete' });
    const promptNode = nodes.value.get('prompt-1');
    expect(promptNode?.data.threadStatus).toBe('answered');

    // A restarted server settles the abandoned stream and drops `_activeResponseId`
    // from its snapshot: a late delta for it routes nowhere.
    EVENT_HANDLERS['canvas-response-start']({ responseNodeId: 'resp-3', promptNodeId: 'prompt-1' });
    const thread = nodes.value.get('prompt-1')!;
    nodes.value = new Map([['prompt-1', { ...thread, data: { ...thread.data, _activeResponseId: undefined } }]]);
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'resp-3', content: 'from the old server' });
    expect(threadTurns('prompt-1')[3]).toMatchObject({ text: '' });
  });

  test('disconnect closes the EventSource a reconnect opened, not only the first one', async () => {
    const sources: FakeEventSource[] = [];
    class TrackedEventSource extends FakeEventSource {
      constructor(url: string) {
        super(url);
        sources.push(this);
      }
    }
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: TrackedEventSource as unknown as typeof EventSource,
    });
    const disconnect = connectSSE();
    sources[0]?.onerror?.(new Event('error'));
    // The first reconnect waits 500 ms.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sources).toHaveLength(2);
    disconnect();
    expect(sources[1]?.closed).toBe(true);
  });

  test('a finished tool returns the status card to the phase it interrupted', () => {
    EVENT_HANDLERS['execution-phase']?.({ phase: 'thinking', detail: 'planning' });
    EVENT_HANDLERS['tool-start']?.({ name: 'bun test' });
    expect(nodes.value.get('status-main')?.data).toMatchObject({ phase: 'tooling', activeTool: 'bun test' });
    EVENT_HANDLERS['tool-complete']?.({ name: 'bun test' });
    expect(nodes.value.get('status-main')?.data).toMatchObject({
      phase: 'thinking',
      detail: 'planning',
      activeTool: null,
    });
  });

  test('a reply sent mid-stream is not overwritten, and a superseded response stops routing', () => {
    EVENT_HANDLERS['canvas-prompt-created']({ nodeId: 'prompt-2', text: 'first' });
    EVENT_HANDLERS['canvas-response-start']({ responseNodeId: 'r1', promptNodeId: 'prompt-2' });
    EVENT_HANDLERS['canvas-prompt-created']({ nodeId: 'prompt-2', threadNodeId: 'prompt-2', text: 'follow-up' });
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'r1', content: 'first answer' });
    EVENT_HANDLERS['canvas-response-complete']({ responseNodeId: 'r1', content: 'first answer' });
    expect(threadTurns('prompt-2').map((turn) => [turn.role, turn.text, turn.status])).toEqual([
      ['user', 'first', 'pending'],
      ['assistant', 'first answer', 'complete'],
      ['user', 'follow-up', 'pending'],
    ]);
    expect(nodes.value.get('prompt-2')?.data.threadStatus).toBe('pending');

    EVENT_HANDLERS['canvas-response-start']({ responseNodeId: 'r2', promptNodeId: 'prompt-2' });
    EVENT_HANDLERS['canvas-response-start']({ responseNodeId: 'r3', promptNodeId: 'prompt-2' });
    EVENT_HANDLERS['canvas-response-delta']({ responseNodeId: 'r2', content: 'stale' });
    EVENT_HANDLERS['canvas-response-complete']({ responseNodeId: 'r3', content: 'second answer' });
    expect(
      threadTurns('prompt-2')
        .slice(3)
        .map((turn) => [turn.text, turn.status]),
    ).toEqual([
      ['', 'complete'],
      ['second answer', 'complete'],
    ]);
    expect(nodes.value.get('prompt-2')?.data.threadStatus).toBe('answered');
  });
});
