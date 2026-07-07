import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import {
  activeNodeId,
  contextPinnedNodeIds,
  edges,
  nodes,
  selectedNodeIds,
  viewport,
} from '../../src/client/state/canvas-store.ts';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const originalLocalStorage = globalThis.localStorage;

let fetchBodies: Array<Record<string, unknown>> = [];

function resetClientState(): void {
  viewport.value = { x: 0, y: 0, scale: 1 };
  nodes.value = new Map();
  edges.value = new Map();
  activeNodeId.value = null;
  selectedNodeIds.value = new Set();
  contextPinnedNodeIds.value = new Set();
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> | null {
  if (typeof init?.body !== 'string') return null;
  const parsed = JSON.parse(init.body) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

describe('ext-app open browser sync', () => {
  beforeEach(() => {
    resetClientState();
    fetchBodies = [];

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
      value: ((input: RequestInfo | URL, init?: RequestInit) => {
        const body = parseBody(init);
        if (body) fetchBodies.push(body);
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }) satisfies typeof fetch,
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
  });

  test('suppresses auto-focus layout and viewport commits from undo history', () => {
    EVENT_HANDLERS['ext-app-open']({
      toolCallId: 'undo-history-open',
      nodeId: 'ext-app-undo-history-open',
      title: 'Undo history app',
      html: '<main>app</main>',
      toolInput: {},
      serverName: 'Fixture',
      toolName: 'show_counter',
    });

    expect(nodes.value.has('ext-app-undo-history-open')).toBe(true);
    expect(fetchBodies.length).toBeGreaterThanOrEqual(2);
    expect(fetchBodies.every((body) => body.recordHistory === false)).toBe(true);
  });
});
